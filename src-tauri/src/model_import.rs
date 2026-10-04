//! Native model import: picker -> isolated local converter -> validated library.
use crate::library::{self, SavedAsset};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

const FORMATS: &[&str] = &[
    "glb", "blend", "fbx", "obj", "gltf", "stl", "ply", "usd", "usda", "usdc", "usdz", "zip",
];
const MAX_SOURCE: u64 = 256 * 1024 * 1024;
const MAX_UNPACKED: u64 = 512 * 1024 * 1024;
const MAX_OUTPUT: u64 = 512 * 1024 * 1024;
static IMPORT: Mutex<()> = Mutex::new(());
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
pub struct ImportedModel {
    pub asset: SavedAsset,
    pub warnings: Vec<String>,
}
#[derive(Deserialize)]
struct Conversion {
    ok: bool,
    #[serde(default)]
    warnings: Vec<String>,
    error: Option<String>,
    #[serde(default)]
    blender: String,
}

fn extension(path: &Path) -> String {
    path.extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase()
}
fn validate_source(path: &Path) -> Result<(), String> {
    if !FORMATS.contains(&extension(path).as_str()) {
        return Err(
            "Choose a Blender, FBX, OBJ, glTF, STL, PLY, USD model or an asset ZIP.".into(),
        );
    }
    let metadata = fs::metadata(path).map_err(|_| "Could not read the selected model.")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_SOURCE {
        return Err("Choose a model file under 256 MB.".into());
    }
    Ok(())
}

fn unpack(source: &Path, destination: &Path) -> Result<PathBuf, String> {
    let file = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|_| "This asset ZIP could not be opened.")?;
    if archive.len() > 4096 {
        return Err(
            "This ZIP contains too many files. Extract the asset and choose its model instead."
                .into(),
        );
    }
    let mut total = 0u64;
    let mut candidates = vec![];
    for index in 0..archive.len() {
        if CANCEL.load(Ordering::Relaxed) {
            return Err("Import cancelled.".into());
        }
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or("The ZIP contains an unsafe file path.")?
            .to_owned();
        if relative.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        }) || entry.name().contains('\\')
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("The ZIP contains an unsafe file path or symbolic link.".into());
        }
        if relative.to_string_lossy().len() > 500 {
            return Err("The ZIP contains an overly long file path.".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("The ZIP is too large.")?;
        if total > MAX_UNPACKED || entry.size() > MAX_SOURCE {
            return Err(
                "Keep extracted asset ZIPs under 512 MB, with each file under 256 MB.".into(),
            );
        }
        let path = destination.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "The ZIP contains duplicate files.")?;
        let copied = std::io::copy(&mut entry.by_ref().take(MAX_SOURCE + 1), &mut output)
            .map_err(|e| e.to_string())?;
        if copied != entry.size() || copied > MAX_SOURCE {
            return Err("The asset ZIP is incomplete or too large.".into());
        }
        if !relative.components().any(|p| p.as_os_str() == "__MACOSX")
            && FORMATS.contains(&extension(&path).as_str())
            && extension(&path) != "zip"
        {
            candidates.push(path);
        }
    }
    // Source packages often include both Blender and interchange versions.
    // Prefer the authored Blender project; never guess between multiple assets.
    for formats in [
        &["blend"][..],
        &["glb", "gltf"][..],
        &["fbx"][..],
        &["obj"][..],
        &["usd", "usda", "usdc", "usdz", "stl", "ply"][..],
    ] {
        let matching: Vec<_> = candidates
            .iter()
            .filter(|p| formats.contains(&extension(p).as_str()))
            .collect();
        if matching.len() > 1 {
            return Err("This ZIP contains several models. Extract it and import the model you want; kit import will be separate.".into());
        }
        if let Some(model) = matching.first() {
            validate_source(model)?;
            return Ok((*model).clone());
        }
    }
    Err("The ZIP does not contain a supported model.".into())
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = vec![];
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("The converted model is too large. Keep the finished GLB under 512 MB.".into());
    }
    Ok(bytes)
}

fn runtime(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    #[cfg(debug_assertions)]
    let base = app
        .path()
        .resource_dir()
        .ok()
        .map(|path| path.join("converter"))
        .filter(|path| path.join("runtime/studio-runtime.json").is_file())
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("converter"));
    #[cfg(not(debug_assertions))]
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("converter");
    let python = base.join(if cfg!(windows) {
        "runtime/python.exe"
    } else {
        "runtime/bin/python3"
    });
    if !python.is_file() || !base.join("convert.py").is_file() {
        return Err(
            "The bundled model converter is missing. Reinstall Studio to restore it.".into(),
        );
    }
    Ok((python, base.join("convert.py")))
}

fn convert(
    python: &Path,
    script: &Path,
    source: &Path,
    work: &Path,
    timeout: Duration,
) -> Result<(Vec<u8>, Vec<String>, String), String> {
    let output = work.join("converted.glb");
    let report = work.join("result.json");
    let log = work.join("converter.log");
    let stdout = fs::File::create(&log).map_err(|e| e.to_string())?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
    let mut command = Command::new(python);
    command
        .args(["-I"])
        .arg(script)
        .arg(source)
        .arg(&output)
        .arg(&report)
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env("BLENDER_USER_RESOURCES", work.join("preferences"))
        .current_dir(work)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start the model converter: {e}"))?;
    let started = Instant::now();
    let status = loop {
        let reason = if CANCEL.load(Ordering::Relaxed) {
            Some("Import cancelled.")
        } else if started.elapsed() > timeout {
            Some("The model took too long to convert. Try a smaller model or export a GLB from Blender.")
        } else if fs::metadata(&log).is_ok_and(|m| m.len() > 8 * 1024 * 1024) {
            Some("The converter produced too many errors. Check the source model in Blender.")
        } else {
            None
        };
        if let Some(reason) = reason {
            let _ = child.kill();
            let _ = child.wait();
            return Err(reason.into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.to_string());
            }
        }
    };
    let result: Conversion = read_limited(&report, 64 * 1024).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .ok_or("The converter could not open this file. It may use a newer Blender version or be damaged.")?;
    if !status.success() || !result.ok {
        return Err(result
            .error
            .unwrap_or_else(|| "The model could not be converted.".into()));
    }
    if CANCEL.load(Ordering::Relaxed) {
        return Err("Import cancelled.".into());
    }
    let model = read_limited(&output, MAX_OUTPUT)?;
    library::inspect_glb(&model)?;
    Ok((model, result.warnings, result.blender))
}

pub(crate) struct PreparedModel {
    pub bytes: Vec<u8>,
    pub warnings: Vec<String>,
    pub note: String,
    pub source: Option<PathBuf>,
    _work: tempfile::TempDir,
}
// Catalog downloads and local imports share the same converter and safeguards.
pub(crate) fn prepare_catalog_model(
    app: &tauri::AppHandle,
    source: &Path,
    stage: impl Fn(&str, &str),
) -> Result<PreparedModel, String> {
    stage("queued", "Waiting for the model converter…");
    let _guard = IMPORT.lock().map_err(|e| e.to_string())?;
    CANCEL.store(false, Ordering::Relaxed);
    prepare_model(app, source, stage)
}
fn prepare_model(
    app: &tauri::AppHandle,
    source: &Path,
    stage: impl Fn(&str, &str),
) -> Result<PreparedModel, String> {
    validate_source(source)?;
    let original_zip = (extension(source) == "zip").then(|| source.to_owned());
    let work = tempfile::Builder::new()
        .prefix("tana-model-import-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let source = if extension(source) == "zip" {
        stage("extracting", "Opening the asset package…");
        unpack(source, &work.path().join("asset"))?
    } else {
        source.to_owned()
    };
    let direct = if extension(&source) == "glb" {
        read_limited(&source, MAX_OUTPUT)
            .ok()
            .filter(|bytes| library::inspect_glb(bytes).is_ok())
            .filter(|bytes| {
                let length = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
                let doc: serde_json::Value =
                    serde_json::from_slice(&bytes[20..20 + length]).unwrap();
                !doc["extensionsRequired"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|item| {
                        matches!(
                            item.as_str(),
                            Some("KHR_draco_mesh_compression" | "EXT_meshopt_compression")
                        )
                    })
            })
    } else {
        None
    };
    let (bytes, warnings, engine) = if let Some(bytes) = direct {
        (bytes, vec![], "GLB passthrough".into())
    } else {
        stage("converting", "Converting the model on your computer…");
        let (python, script) = runtime(app)?;
        convert(
            &python,
            &script,
            &source,
            work.path(),
            Duration::from_secs(300),
        )?
    };
    if CANCEL.load(Ordering::Relaxed) {
        return Err("Import cancelled.".into());
    }

    let note = format!(
        "Imported from {}\nConverter: {}\n{}\n",
        source.file_name().unwrap_or_default().to_string_lossy(),
        engine,
        warnings.join("\n")
    );
    let packed = work.path().join("source.blend");
    let preserved = original_zip.or_else(|| packed.is_file().then_some(packed));
    Ok(PreparedModel {
        bytes,
        warnings,
        note,
        source: preserved,
        _work: work,
    })
}
fn import_path(
    app: &tauri::AppHandle,
    category: &str,
    source: &Path,
) -> Result<ImportedModel, String> {
    let model = prepare_model(app, source, |_, label| {
        let _ = app.emit("library-import-progress", label);
    })?;
    let _ = app.emit("library-import-progress", "Saving to your collection…");
    let name = source.file_stem().unwrap_or_default().to_string_lossy();
    let asset = library::save_import(
        &library::root(app)?,
        &name,
        category,
        &model.bytes,
        model.source.as_deref().map(|p| (p, model.note.as_str())),
    )?;
    Ok(ImportedModel {
        asset,
        warnings: model.warnings,
    })
}

#[tauri::command]
pub async fn library_pick_import(
    app: tauri::AppHandle,
    category: String,
) -> Result<Option<ImportedModel>, String> {
    if !["props", "characters", "scenes"].contains(&category.as_str()) {
        return Err("Choose objects, characters or scenes.".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = IMPORT
            .try_lock()
            .map_err(|_| "An import is already running.")?;
        CANCEL.store(false, Ordering::Relaxed);
        #[cfg(debug_assertions)]
        let fixture = std::env::var_os("STUDIO_IMPORT_SMOKE_FILE").map(PathBuf::from);
        #[cfg(not(debug_assertions))]
        let fixture: Option<PathBuf> = None;
        let path = if let Some(path) = fixture {
            Some(path)
        } else {
            app.dialog()
                .file()
                .set_title("Import a model into Studio")
                .add_filter("3D models and asset packages", FORMATS)
                .blocking_pick_file()
                .map(|p| p.into_path())
                .transpose()
                .map_err(|_| "Could not read the chosen file path.")?
        };
        let Some(path) = path else {
            return Ok(None);
        };
        let imported = import_path(&app, &category, &path)?;
        let _ = app.emit("library-changed", &imported.asset);
        Ok(Some(imported))
    })
    .await
    .map_err(|e| e.to_string())?;
    result
}

#[tauri::command]
pub fn library_cancel_import() {
    CANCEL.store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn archive(files: &[(&str, &[u8])]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (name, bytes) in files {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        (dir, path)
    }
    #[test]
    fn packages_keep_companions_and_do_not_guess_between_models() {
        CANCEL.store(false, Ordering::Relaxed);
        let (dir, source) = archive(&[
            ("asset/model.blend", b"BLENDER"),
            ("asset/model.obj", b"o model"),
            ("asset/textures/colour.png", b"texture"),
        ]);
        let unpacked = unpack(&source, &dir.path().join("out")).unwrap();
        assert!(unpacked.ends_with("asset/model.blend"));
        assert!(unpacked
            .parent()
            .unwrap()
            .join("textures/colour.png")
            .is_file());
        let (dir, source) = archive(&[("first.obj", b"o first"), ("second.obj", b"o second")]);
        assert!(unpack(&source, &dir.path().join("out"))
            .unwrap_err()
            .contains("several models"));
    }
    #[test]
    fn packages_cannot_write_outside_their_staging_folder() {
        let (dir, source) = archive(&[("../outside.blend", b"BLENDER")]);
        assert!(unpack(&source, &dir.path().join("out")).is_err());
        assert!(!dir.path().join("outside.blend").exists());
    }
    #[test]
    fn an_unrelated_file_is_not_an_importable_model() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        fs::write(&path, "notes").unwrap();
        assert!(validate_source(&path).is_err());
    }
}
