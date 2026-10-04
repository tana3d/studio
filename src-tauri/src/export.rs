//! Saving is explicit: only an export provided by the editor, to a path chosen
//! in the native dialog. Studio never scans or indexes local files.
use base64::{engine::general_purpose::STANDARD, Engine};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_export(
    app: tauri::AppHandle,
    name: String,
    data: String,
) -> Result<bool, String> {
    if name.len() > 120
        || name.contains(['/', '\\'])
        || ![".mp4", ".webm", ".zip"]
            .iter()
            .any(|ext| name.ends_with(ext))
    {
        return Err("Invalid export filename.".into());
    }
    if data.len() > 512 * 1024 * 1024 {
        return Err(
            "This export is too large to save. Try a shorter scene or lower quality.".into(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || {
        let extension = name.rsplit('.').next().unwrap_or("zip").to_owned();
        let path = app
            .dialog()
            .file()
            .set_title("Save Studio export")
            .set_file_name(&name)
            .add_filter("Studio export", &[&extension])
            .blocking_save_file();
        let Some(path) = path else {
            return Ok(false);
        };
        let path = path
            .into_path()
            .map_err(|_| "Could not read the selected path.".to_string())?;
        let bytes = STANDARD
            .decode(data)
            .map_err(|_| "The export data is invalid.".to_string())?;
        std::fs::write(path, bytes)
            .map_err(|_| "Could not save the export to this folder.".to_string())?;
        Ok(true)
    })
    .await
    .map_err(|_| "The export was interrupted.".to_string())?
}
