//! Local game-style mouse capture. No global monitor or OS input permission.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct Capture(Arc<AtomicBool>);

#[tauri::command]
pub fn studio_capture_mouse(window: tauri::Window, capture: bool) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("Mouse capture belongs to the scene window.".into());
    }
    #[cfg(target_os = "macos")]
    {
        if capture && !window.is_focused().map_err(|e| e.to_string())? {
            return Err("Click the scene window first.".into());
        }
        window.set_cursor_grab(capture).map_err(|e| e.to_string())?;
        if let Err(error) = window.set_cursor_visible(!capture) {
            let _ = window.set_cursor_grab(false);
            return Err(error.to_string());
        }
        window
            .state::<Capture>()
            .0
            .store(capture, Ordering::Release);
        Ok(capture)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = capture;
        Ok(false)
    }
}

pub fn release(window: &tauri::Window) {
    if window.label() != "main" {
        return;
    }
    if window.state::<Capture>().0.swap(false, Ordering::AcqRel) {
        let _ = window.set_cursor_grab(false);
        let _ = window.set_cursor_visible(true);
        let _ = window.emit("studio-mouse-released", ());
    }
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(Capture::default());
    #[cfg(target_os = "macos")]
    {
        use block2::RcBlock;
        use objc2_app_kit::{NSEvent, NSEventMask};
        use std::ptr::NonNull;
        let capture = app.state::<Capture>().0.clone();
        let handle = app.handle().clone();
        let block = RcBlock::new(move |event: NonNull<NSEvent>| {
            // AppKit owns this event for the callback; return it unchanged.
            if capture.load(Ordering::Acquire) {
                let event = unsafe { event.as_ref() };
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.emit("studio-mouse-look", [event.deltaX(), event.deltaY()]);
                }
            }
            event.as_ptr()
        });
        let mask = NSEventMask::MouseMoved
            | NSEventMask::LeftMouseDragged
            | NSEventMask::RightMouseDragged;
        let monitor =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block) }
                .ok_or("Could not enable scene mouse input.")?;
        MONITOR.with(|slot| *slot.borrow_mut() = Some(monitor));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
thread_local! {
    static MONITOR: std::cell::RefCell<Option<objc2::rc::Retained<objc2::runtime::AnyObject>>> = const { std::cell::RefCell::new(None) };
}
