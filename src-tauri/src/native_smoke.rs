//! Opt-in smoke test report for the actual OS webview, never active in releases.
#[tauri::command]
pub fn native_smoke_report(report: serde_json::Value) -> Result<(), String> {
    #[cfg(debug_assertions)]
    if let Ok(path) = std::env::var("STUDIO_SMOKE_REPORT") {
        let bytes = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
        std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    }
    let _ = report;
    Ok(())
}
