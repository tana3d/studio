mod chatgpt;
mod collection;
mod export;
mod library;
mod loopback;
mod model_import;
mod native_smoke;
mod scene_tools;

use chatgpt::ChatGptState;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            chatgpt::chatgpt_status,
            chatgpt::chatgpt_start,
            chatgpt::chatgpt_cancel,
            chatgpt::chatgpt_disconnect,
            chatgpt::chatgpt_models,
            chatgpt::chatgpt_ask,
            chatgpt::chatgpt_stop,
            chatgpt::chatgpt_usage,
            export::save_export,
            library::library_list,
            library::library_catalog,
            library::library_download,
            library::library_import,
            model_import::library_pick_import,
            model_import::library_cancel_import,
            library::library_read,
            library::library_measure,
            library::library_open_folder,
            library::library_preview,
            library::library_open_link,
            library::library_open_browser,
            library::library_close_browser,
            native_smoke::native_smoke_report,
        ])
        .on_page_load(|_webview, _payload| {
            #[cfg(debug_assertions)]
            if _payload.event() == tauri::webview::PageLoadEvent::Finished
                && _webview.label() == "main"
                && std::env::var_os("STUDIO_IMPORT_SMOKE_REPORT").is_some()
            {
                let _ = _webview.eval(include_str!("../../tests/native-import-smoke.js"));
            }
            #[cfg(debug_assertions)]
            if _payload.event() == tauri::webview::PageLoadEvent::Finished
                && _webview.label() == "main"
                && std::env::var_os("STUDIO_SMOKE_REPORT").is_some()
            {
                let _ = _webview.eval(include_str!("../../tests/native-smoke.js"));
            }
            #[cfg(debug_assertions)]
            if _payload.event() == tauri::webview::PageLoadEvent::Finished
                && _webview.label() == "main"
                && std::env::var_os("STUDIO_AGENT_SMOKE_REPORT").is_some()
            {
                let _ = _webview.eval(include_str!("../../tests/native-agent-smoke.js"));
            }
            #[cfg(debug_assertions)]
            if _payload.event() == tauri::webview::PageLoadEvent::Finished
                && _webview.label() == "main"
                && std::env::var_os("STUDIO_LIBRARY_SMOKE_REPORT").is_some()
            {
                let _ = _webview.eval(include_str!("../../tests/native-library-smoke.js"));
            }
            #[cfg(debug_assertions)]
            if _payload.event() == tauri::webview::PageLoadEvent::Finished
                && _webview.label() == "catalog"
                && std::env::var_os("STUDIO_CATALOG_SMOKE_REPORT").is_some()
            {
                let _ = _webview.eval(include_str!("../../tests/native-catalog-smoke.js"));
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(catalog) = window.app_handle().get_webview_window("catalog") {
                    let _ = catalog.close();
                }
            }
        })
        .setup(|app| {
            // No tray, global shortcuts, file crawler, or background index.
            app.manage(Arc::new(ChatGptState::new(app.handle().clone())?));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Could not launch Tana Studio");
}
