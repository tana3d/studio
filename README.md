# Studio by tana

Build worlds, direct character performances, arrange camera angles, and export your story.

Studio combines a local Three.js scene editor with a ChatGPT conversation in a Tauri desktop app. Chat occupies one third of the window; the scene editor occupies two thirds. The editor is bundled into the app and works without a separate server.

## Development

Requires Node.js 24+, Rust 1.96, and the platform's Tauri build prerequisites.

```sh
npm install
CARGO_TARGET_DIR="$PWD/.target" CARGO_BUILD_JOBS=2 npm run tauri -- dev
```

Desktop development uses port **1420**. The standalone Worldbuilder server on **8648** is a separate app and is left intact. Do not move either server to another port or stop unrelated servers.

```sh
npm run check
npm run build
npm test
npm run test:ui
CARGO_TARGET_DIR="$PWD/.target" CARGO_BUILD_JOBS=2 cargo test --locked --manifest-path src-tauri/Cargo.toml
CARGO_TARGET_DIR="$PWD/.target" CARGO_BUILD_JOBS=2 cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Build distributables with `npm run tauri -- build`. Artifacts land in `.target/release/bundle` when using the target directory above. macOS builds are not yet signed or notarized for distribution. Automatic updates are disabled until Tana has its own release service.

To smoke-test the actual OS webview, create `.tmp` and launch dev mode with `STUDIO_SMOKE_REPORT="$PWD/.tmp/native-smoke.json"`. This opt-in debug test loads the scene and exports/decodes a short video without signing in or calling a model. Close the test app afterward and launch normal dev mode for a fresh scene.

## What is included

- Asset library, GLB imports, animated performers, character and camera controls.
- Layered performance timeline, camera shots, splits, undo/redo, fade and wipe transitions.
- Landscape 16:9 and vertical 9:16 video framing, MP4/WebM and quality selection where supported by the host's webview.
- Native save dialogs for footage and scene ZIP exports. Unzip scene exports to get the footage folder.
- Sign in with ChatGPT, dynamically supplied model choices, streaming conversation, Stop and New chat.
- Optional scene context with camera and performance descriptions; never sends mesh buffers, animation frames, or local files automatically.

The inherited desktop search UI, menu-bar/tray app, global shortcuts, file crawler/index, Deka runtime, app generation, terminal, and Zega account/update services have been removed. The scene editor retains its movement and editing controls. See [editor controls and details](docs/editor.md).

## Current boundaries

ChatGPT helps plan scenes and shots. It cannot manipulate the scene or generate/rig/animate assets yet. Its model list depends on the signed-in account and the provider's supported models. Credentials live in Studio's own OS credential vault; access tokens stay in the native process and are never exposed to the editor.

Conversations and scenes remain in memory for this prototype. Download a scene ZIP before closing when you want to preserve its assets and recorded footage; project import is not implemented yet. Video exports have no audio. Export codec support varies by the operating system's webview, and unsupported choices are disabled.

The browser preview can use the editor but cannot sign in with ChatGPT. Use Tauri dev mode for the complete desktop app.

## Origin and license

The desktop shell and ChatGPT provider are derived from [zegadb/studio](https://github.com/zegadb/studio), prototype commit `1e9e1b3`. The editor comes from [samifouad/worldbuilder](https://github.com/samifouad/worldbuilder), commit `c1ff2d8`. The source repositories remain intact.

Apache-2.0 for the desktop shell; the imported editor is MIT (see [editor/LICENSE](editor/LICENSE)). Third-party models and fonts retain their licenses. See [NOTICE](NOTICE) and [model attribution](editor/assets/ATTRIBUTION.md).
