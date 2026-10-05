//! Opt-in smoke test report for the actual OS webview, never active in releases.
#[tauri::command]
pub fn native_smoke_report(report: serde_json::Value, kind: Option<String>) -> Result<(), String> {
    #[cfg(debug_assertions)]
    if let Ok(path) = (if kind.as_deref() == Some("controls") {
        std::env::var("STUDIO_CONTROLS_SMOKE_REPORT")
    } else if kind.as_deref() == Some("link") {
        std::env::var("STUDIO_LINK_SMOKE_REPORT")
    } else if kind.as_deref() == Some("package") {
        std::env::var("STUDIO_PACKAGE_SMOKE_REPORT")
    } else if kind.as_deref() == Some("import") {
        std::env::var("STUDIO_IMPORT_SMOKE_REPORT")
    } else if kind.as_deref() == Some("catalog") {
        std::env::var("STUDIO_CATALOG_SMOKE_REPORT")
    } else {
        std::env::var("STUDIO_LIBRARY_SMOKE_REPORT")
    })
    .or_else(|_| std::env::var("STUDIO_AGENT_SMOKE_REPORT"))
    .or_else(|_| std::env::var("STUDIO_SMOKE_REPORT"))
    {
        let path = if kind.as_deref() == Some("package") {
            format!(
                "{}.{}.json",
                path,
                if report["catalog"].as_bool() == Some(true) {
                    "catalog"
                } else {
                    "placement"
                }
            )
        } else {
            path
        };
        let bytes = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
        std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    }
    let _ = (report, kind);
    Ok(())
}
