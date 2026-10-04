//! The personal library owns one directory; it never indexes user documents.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

const ORIGIN: &str = "https://tana.gg";
const MAX_MODEL: usize = 50 * 1024 * 1024;
static WRITES: Mutex<()> = Mutex::new(());
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavedAsset {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) category: String,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    #[serde(default)]
    pub(crate) animations: Vec<String>,
    #[serde(default)]
    pub(crate) catalog: Option<Value>,
    #[serde(default)]
    pub(crate) footprint: Option<[f64; 2]>,
    #[serde(default)]
    pub(crate) height: Option<f64>,
    pub(crate) sha256: String,
}
pub(crate) fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid library asset.".into());
    }
    Ok(())
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map(|p| p.join("TanaStudio").join("Library"))
        .map_err(|_| "Could not locate your Documents folder.".into())
}
pub(crate) fn plain(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Library files cannot be symbolic links.".into());
    }
    Ok(())
}
pub(crate) fn read_asset(dir: &Path, id: &str) -> Result<SavedAsset, String> {
    valid_id(id)?;
    let folder = dir.join(id);
    plain(&folder)?;
    let manifest = folder.join("asset.json");
    plain(&manifest)?;
    let bytes = fs::read(&manifest).map_err(|e| e.to_string())?;
    if bytes.len() > 256 * 1024 {
        return Err("Invalid library record.".into());
    }
    let asset: SavedAsset =
        serde_json::from_slice(&bytes).map_err(|_| "Could not read this library record.")?;
    if asset.id != id {
        return Err("Library record does not match its folder.".into());
    }
    plain(&folder.join("model.glb"))?;
    Ok(asset)
}
fn inspect_glb(bytes: &[u8]) -> Result<Vec<String>, String> {
    let number =
        |offset| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
    if bytes.len() < 20
        || bytes.len() > MAX_MODEL
        || &bytes[..4] != b"glTF"
        || number(4) != 2
        || number(8) != bytes.len()
        || &bytes[16..20] != b"JSON"
    {
        return Err("Choose a valid, self-contained GLB under 50 MB.".into());
    }
    let end = 20usize
        .checked_add(number(12))
        .filter(|end| *end <= bytes.len())
        .ok_or("Invalid GLB contents.")?;
    let doc: Value =
        serde_json::from_slice(&bytes[20..end]).map_err(|_| "Invalid GLB contents.")?;
    for key in ["buffers", "images"] {
        for item in doc[key].as_array().into_iter().flatten() {
            if item
                .get("uri")
                .is_some_and(|u| !u.as_str().is_some_and(|s| s.starts_with("data:")))
            {
                return Err("Embed textures and buffers in the GLB before importing.".into());
            }
        }
    }
    if doc["meshes"].as_array().is_none_or(|a| a.is_empty()) {
        return Err("This model contains no meshes.".into());
    }
    Ok(doc["animations"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(i, a)| {
            a["name"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("Animation {}", i + 1))
        })
        .collect())
}
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("TanaStudio/0.1")
        .build()
        .map_err(|e| e.to_string())
}
fn fetch(client: &reqwest::blocking::Client, path: &str, max: usize) -> Result<Vec<u8>, String> {
    Ok(fetch_counted(client, path, max)?.0)
}
fn fetch_counted(
    client: &reqwest::blocking::Client,
    path: &str,
    max: usize,
) -> Result<(Vec<u8>, Option<u64>), String> {
    let response = client
        .get(format!("{ORIGIN}{path}"))
        .send()
        .map_err(|_| "Could not reach the Tana library. Check your connection.")?;
    if !response.status().is_success() {
        return Err(format!(
            "Tana library returned {}. Try again shortly.",
            response.status()
        ));
    }
    if response.content_length().is_some_and(|n| n > max as u64) {
        return Err("This download is too large.".into());
    }
    let downloads = response
        .headers()
        .get("X-Download-Count")
        .and_then(|h| h.to_str().ok())
        .and_then(|n| n.parse::<u64>().ok());
    let mut bytes = Vec::new();
    response
        .take((max + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > max {
        return Err("This download is too large.".into());
    }
    Ok((bytes, downloads))
}
fn media_path(key: &str) -> Result<String, String> {
    // Only our own published R2 media keys, never a URL supplied by the webview.
    if !key.starts_with("assets/")
        || key.len() > 512
        || key.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || !part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        })
    {
        return Err("Invalid catalog download path.".into());
    }
    Ok(format!("/media/{key}"))
}
fn text(doc: &Value, key: &str) -> Result<String, String> {
    doc[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| format!("Catalog asset is missing {key}."))
}
fn persist(
    dir: &Path,
    asset: SavedAsset,
    model: &[u8],
    preview: Option<&[u8]>,
) -> Result<SavedAsset, String> {
    valid_id(&asset.id)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    if dir.join(&asset.id).exists() {
        return read_asset(dir, &asset.id);
    }
    let mut random = [0; 8];
    getrandom::getrandom(&mut random).map_err(|e| e.to_string())?;
    let staging = dir.join(format!(".download-{:016x}", u64::from_le_bytes(random)));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let result = (|| {
        fs::write(staging.join("model.glb"), model).map_err(|e| e.to_string())?;
        if let Some(bytes) = preview {
            fs::write(staging.join("preview"), bytes).map_err(|e| e.to_string())?;
        }
        fs::write(
            staging.join("asset.json"),
            serde_json::to_vec_pretty(&asset).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if let Some(c) = &asset.catalog {
            let credit = format!(
                "{}\nCreator: {}\nSource: {}\nLicence: {}\nLicence URL: {}\n{}\n",
                asset.name,
                c["creator"].as_str().unwrap_or(""),
                c["source_url"].as_str().unwrap_or(""),
                c["license"].as_str().unwrap_or(""),
                c["license_url"].as_str().unwrap_or(""),
                c["attribution"].as_str().unwrap_or("")
            );
            fs::write(staging.join("SOURCE.txt"), credit).map_err(|e| e.to_string())?;
        }
        fs::rename(&staging, dir.join(&asset.id)).map_err(|e| e.to_string())?;
        Ok(asset)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(staging);
    }
    result
}
async fn background<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn library_list(app: tauri::AppHandle) -> Result<Value, String> {
    let dir = root(&app)?;
    background(move || {
        let (assets, skipped) = crate::collection::with(&dir, |collection| collection.list())?;
        Ok(json!({"root":dir,"assets":assets,"skipped":skipped}))
    })
    .await
}
#[tauri::command]
pub async fn library_catalog(q: String, category: String, page: u32) -> Result<Value, String> {
    background(move || {
        let mut url = reqwest::Url::parse(&format!("{ORIGIN}/api/assets")).unwrap();
        url.query_pairs_mut()
            .append_pair("q", &q.chars().take(120).collect::<String>())
            .append_pair("category", &category)
            .append_pair("page", &page.clamp(1, 100000).to_string())
            .append_pair("limit", "24");
        let path = format!("{}?{}", url.path(), url.query().unwrap_or(""));
        serde_json::from_slice(&fetch(&client()?, &path, 2 * 1024 * 1024)?)
            .map_err(|_| "Could not read the catalog.".into())
    })
    .await
}
#[tauri::command]
pub async fn library_download(app: tauri::AppHandle, id: String) -> Result<SavedAsset, String> {
    valid_id(&id)?;
    let dir = root(&app)?;
    let asset = background(move || {
        let _guard = WRITES.lock().map_err(|e| e.to_string())?;
        if dir.join(&id).exists() {
            return crate::collection::with(&dir, |collection| {
                if let Some(saved) = collection.get(&id)? {
                    return Ok(saved);
                }
                let saved = read_asset(&dir, &id)?;
                collection.put(&saved)?;
                Ok(saved)
            });
        }
        let client = client()?;
        let mut catalog: Value =
            serde_json::from_slice(&fetch(&client, &format!("/api/assets/{id}"), 256 * 1024)?)
                .map_err(|_| "Could not read this catalog asset.")?;
        if text(&catalog, "id")? != id {
            return Err("Catalog asset does not match the download.".into());
        }
        let name = text(&catalog, "name")?;
        let category = text(&catalog, "category")?;
        if !["props", "characters", "scenes"].contains(&category.as_str()) {
            return Err("Unknown catalog category.".into());
        }
        let (model, downloads) =
            fetch_counted(&client, &format!("/api/assets/{id}/download"), MAX_MODEL)?;
        if let Some(downloads) = downloads {
            catalog["downloads"] = json!(downloads);
        }
        if catalog["model_bytes"].as_u64() != Some(model.len() as u64) {
            return Err("The model download was incomplete. Please try again.".into());
        }
        let animations = inspect_glb(&model)?;
        let preview_key = catalog["poster_key"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or(catalog["preview_key"].as_str())
            .ok_or("Missing preview.")?;
        let preview = fetch(&client, &media_path(preview_key)?, 8 * 1024 * 1024)?;
        let tags = catalog["tags"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect();
        let asset = SavedAsset {
            id,
            name,
            category,
            tags,
            animations,
            catalog: Some(catalog),
            footprint: None,
            height: None,
            sha256: format!("{:x}", Sha256::digest(&model)),
        };
        let saved = persist(&dir, asset, &model, Some(&preview))?;
        crate::collection::with(&dir, |collection| collection.put(&saved))?;
        Ok(saved)
    })
    .await?;
    let _ = app.emit("library-changed", &asset);
    Ok(asset)
}
#[tauri::command]
pub async fn library_import(
    app: tauri::AppHandle,
    name: String,
    category: String,
    data: String,
) -> Result<SavedAsset, String> {
    let dir = root(&app)?;
    let asset = background(move || {
        if data.len() > MAX_MODEL * 4 / 3 + 4 {
            return Err("Keep models under 50 MB.".into());
        }
        let model = STANDARD
            .decode(data)
            .map_err(|_| "Could not read the imported file.")?;
        let animations = inspect_glb(&model)?;
        let hash = format!("{:x}", Sha256::digest(&model));
        if !["props", "characters", "scenes"].contains(&category.as_str()) {
            return Err("Choose objects, characters or scenes.".into());
        }
        let name = name
            .trim()
            .trim_end_matches(".glb")
            .chars()
            .take(160)
            .collect::<String>();
        if name.is_empty() {
            return Err("Give this model a name.".into());
        }
        let asset = SavedAsset {
            id: format!("local-{category}-{hash}"),
            name,
            category,
            tags: vec![],
            animations,
            catalog: None,
            footprint: None,
            height: None,
            sha256: hash,
        };
        let _guard = WRITES.lock().map_err(|e| e.to_string())?;
        let saved = persist(&dir, asset, &model, None)?;
        crate::collection::with(&dir, |collection| collection.put(&saved))?;
        Ok(saved)
    })
    .await?;
    let _ = app.emit("library-changed", &asset);
    Ok(asset)
}
#[tauri::command]
pub async fn library_read(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let dir = root(&app)?;
    background(move || {
        let asset = read_asset(&dir, &id)?;
        let mut bytes = vec![];
        fs::File::open(dir.join(&id).join("model.glb"))
            .map_err(|e| e.to_string())?
            .take((MAX_MODEL + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if format!("{:x}", Sha256::digest(&bytes)) != asset.sha256 {
            return Err(
                "This saved model has changed or is incomplete. Restore its original model.glb."
                    .into(),
            );
        }
        inspect_glb(&bytes)?;
        Ok(STANDARD.encode(bytes))
    })
    .await
}
#[tauri::command]
pub async fn library_measure(
    app: tauri::AppHandle,
    id: String,
    footprint: [f64; 2],
    height: f64,
) -> Result<(), String> {
    let dir = root(&app)?;
    background(move || {
        if footprint
            .iter()
            .chain([&height])
            .any(|n| !n.is_finite() || *n <= 0.0 || *n > 100000.0)
        {
            return Err("Invalid model dimensions.".into());
        }
        let _guard = WRITES.lock().map_err(|e| e.to_string())?;
        let mut asset = crate::collection::with(&dir, |collection| {
            collection
                .get(&id)?
                .ok_or("Missing collection record.".into())
        })?;
        asset.footprint = Some(footprint);
        asset.height = Some(height);
        let temporary = dir.join(&id).join(".asset.json");
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(&asset).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(temporary, dir.join(&id).join("asset.json")).map_err(|e| e.to_string())?;
        crate::collection::with(&dir, |collection| collection.put(&asset))
    })
    .await
}
#[tauri::command]
pub async fn library_preview(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let dir = root(&app)?;
    background(move || {
        read_asset(&dir, &id)?;
        let file = dir.join(id).join("preview");
        if !file.exists() {
            return Ok(None);
        }
        plain(&file)?;
        let mut bytes = vec![];
        fs::File::open(file)
            .map_err(|e| e.to_string())?
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("Preview is too large.".into());
        }
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(b"GIF8") {
            "image/gif"
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            "image/jpeg"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            "image/webp"
        } else {
            return Err("Unsupported preview.".into());
        };
        Ok(Some(format!(
            "data:{mime};base64,{}",
            STANDARD.encode(bytes)
        )))
    })
    .await
}
#[tauri::command]
pub fn library_open_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid source link.")?;
    if !["https", "http"].contains(&parsed.scheme()) {
        return Err("Invalid source link.".into());
    }
    app.opener()
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn library_open_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = root(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn model(doc: Value) -> Vec<u8> {
        let mut json = serde_json::to_vec(&doc).unwrap();
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let mut bytes = b"glTF".to_vec();
        bytes.extend(2u32.to_le_bytes());
        bytes.extend(((20 + json.len()) as u32).to_le_bytes());
        bytes.extend((json.len() as u32).to_le_bytes());
        bytes.extend(b"JSON");
        bytes.extend(json);
        bytes
    }
    #[test]
    fn blocks_traversal_and_remote_resources() {
        for id in ["", "../test", "a/b", "https://test", "x?y"] {
            assert!(valid_id(id).is_err());
        }
        for key in [
            "assets/../model.glb",
            "assets/a//model.glb",
            "https://evil/a",
            "assets/a/m.glb?url=x",
        ] {
            assert!(media_path(key).is_err());
        }
        assert!(media_path("assets/a/b/model.glb").is_ok());
        assert!(inspect_glb(&model(
            json!({"meshes":[{}],"images":[{"uri":"https://evil/image.png"}]})
        ))
        .is_err());
        assert!(inspect_glb(&model(
            json!({"meshes":[{}],"buffers":[{"uri":"../../secret"}]})
        ))
        .is_err());
        assert_eq!(
            inspect_glb(&model(
                json!({"meshes":[{}],"animations":[{"name":"Idle"},{"name":"Walk"}]})
            ))
            .unwrap(),
            vec!["Idle", "Walk"]
        );
    }
    #[test]
    fn rejects_incomplete_glb() {
        let bytes = model(json!({"meshes":[{}]}));
        for length in 0..bytes.len() {
            assert!(inspect_glb(&bytes[..length]).is_err());
        }
        assert!(inspect_glb(&model(json!({}))).is_err());
    }
    #[test]
    fn atomic_save_preserves_existing_metadata_and_ignores_unfinished_downloads() {
        let dir = std::env::temp_dir().join(format!("tana-library-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let bytes = model(json!({"meshes":[{}]}));
        let asset = SavedAsset {
            id: "a".into(),
            name: "Original".into(),
            category: "props".into(),
            tags: vec![],
            animations: vec![],
            catalog: None,
            footprint: None,
            height: None,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        };
        persist(&dir, asset.clone(), &bytes, None).unwrap();
        let mut changed = asset;
        changed.name = "Replaced".into();
        assert_eq!(
            persist(&dir, changed, &bytes, None).unwrap().name,
            "Original"
        );
        assert!(read_asset(&dir, "../a").is_err());
        assert_eq!(fs::read(dir.join("a/model.glb")).unwrap(), bytes);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("a"), dir.join("linked")).unwrap();
            assert!(read_asset(&dir, "linked").is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
}

#[tauri::command]
pub fn library_open_browser(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("catalog") {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "catalog",
        tauri::WebviewUrl::App("studio/catalog.html".into()),
    )
    .title("Tana Library")
    .inner_size(1160.0, 820.0)
    .min_inner_size(600.0, 480.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn library_close_browser(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("catalog") {
        window.close().map_err(|e| e.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    Ok(())
}
