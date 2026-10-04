//! External links can only add a published Tana catalog asset, never supply a
//! file path, a remote download URL, or a scene-editing command.
use std::{collections::VecDeque, sync::Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Default)]
struct Pending(Mutex<VecDeque<String>>);
fn asset_id(link: &str) -> Option<String> {
    let id = link.strip_prefix("tanastudio://download/")?;
    crate::library::valid_id(id).ok()?;
    Some(id.to_owned())
}
fn receive(app: &tauri::AppHandle, links: impl IntoIterator<Item = String>) {
    let state = app.state::<Pending>();
    let Ok(mut queue) = state.0.lock() else {
        return;
    };
    let mut accepted = false;
    for link in links {
        if let Some(id) = asset_id(&link) {
            if queue.len() < 20 && !queue.contains(&id) {
                queue.push_back(id);
                accepted = true;
            }
        }
    }
    drop(queue);
    if accepted {
        // The plugin dispatches URLs while holding Tauri's plugin-store lock.
        // Creating a webview there would re-enter that lock and freeze startup.
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = crate::library::library_open_browser(app.clone()) {
                eprintln!("Could not show Tana Library: {error}");
            }
            let _ = app.emit("catalog-download-requested", ());
        });
    }
}
pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(Pending::default());
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    app.deep_link().register_all()?;
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        receive(&handle, event.urls().into_iter().map(|url| url.to_string()))
    });
    if let Some(urls) = app.deep_link().get_current()? {
        receive(app.handle(), urls.into_iter().map(|url| url.to_string()));
    }
    Ok(())
}
#[tauri::command]
pub fn catalog_take_download_links(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<Pending>();
    let mut queue = state.0.lock().map_err(|e| e.to_string())?;
    Ok(queue.drain(..).collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links_accept_only_catalog_ids_for_the_download_action() {
        assert_eq!(
            asset_id("tanastudio://download/4603a6cd-1567-4a22-947e-ff2f43ab4e19").as_deref(),
            Some("4603a6cd-1567-4a22-947e-ff2f43ab4e19")
        );
        for link in [
            "https://tana.gg/download/id",
            "tanastudio://download/",
            "tanastudio://download/../private",
            "tanastudio://download/%2fprivate",
            "tanastudio://download/id?url=https://other.example/model",
            "tanastudio://download/id#action",
            "tanastudio://place/id",
            "tanastudio://user@download/id",
            "tanastudio://download:80/id",
            "tanastudio://download/id/extra",
            "tanastudio://download/C:\\file.blend",
        ] {
            assert!(asset_id(link).is_none(), "{link}");
        }
    }
}
