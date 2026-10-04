# Studio by tana

Build worlds, direct character performances, arrange camera angles, and export your story.

Studio combines a local Three.js scene editor with a ChatGPT conversation in a Tauri desktop app. Chat starts at one quarter of the window. Drag the divider to resize it, or use the drawer icon to collapse and reopen it. Resizing and collapsing keep your scene and conversation intact. The editor is bundled into the app and works without a separate server.

## Personal asset collection

Open **Library → Browse Tana library** to search the tana.gg catalog, browse categories, and add models to your collection. Each card links to its creator and open licence and shows its download count. The desktop browser opens in a separate resizable window, so you can browse beside your scene. Downloads automatically update the main Library panel. In the web preview, drag the modal’s bottom-right corner to resize it; the header and navigation stay visible as models scroll. Downloading adds a model to the local Library panel; choose it there to place it in the scene. The library has Objects, Characters and Scenes. Characters show their animation count. Loading a Scene keeps its metre scale and turns its mesh pieces into editable objects. It replaces scenery while keeping characters, cameras and performances; Undo restores the previous set. Import rigged actors through Characters.

Models you download or import are saved in **Documents/TanaStudio/Library/<asset-id>/**. Personal metadata is stored by an embedded, revision-pinned Zega graph in `Library/.zega/`, with no separate database process. Startup migrates existing manifests and recovers completed downloads missing a metadata commit. Each portable asset folder contains `model.glb` and a backup `asset.json`; catalog downloads also include `preview` and `SOURCE.txt` with source and licence credits. **Show folder** opens the collection. Files remain available after restarting, and saved models and thumbnails work offline. Startup restores metadata; model geometry loads only when you place an asset. Downloads finish before appearing in the collection and repeated downloads reuse the saved copy. Undo changes your scene while preserving your downloaded collection. Scene ZIP exports retain the source metadata of included catalog models.

The browser preview can browse the public catalog; saving to this collection requires the desktop app. GLBs must embed their textures and buffers and be at most 50 MB. Scenes and recordings still need a scene ZIP export before closing.

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

Build distributables with `npm run tauri -- build`. Artifacts land in `.target/release/bundle` when using the target directory above. macOS development launches sign and verify the native binary with the configured Developer ID Application identity before it accesses Keychain, including after Rust rebuilds. Override `APPLE_SIGNING_IDENTITY` on another developer machine. Release bundles use the same identity; notarization is not configured yet. Account-status checks use saved metadata and never read credentials; token use accesses Keychain only when needed. Automatic updates are disabled until Tana has its own release service.

To smoke-test the actual OS webview, create `.tmp` and launch dev mode with `STUDIO_SMOKE_REPORT="$PWD/.tmp/native-smoke.json"`. This opt-in debug test loads the scene and exports/decodes a short video without signing in or calling a model. Close the test app afterward and launch normal dev mode for a fresh scene.

To verify the catalog in the actual native webview, launch dev with both `STUDIO_LIBRARY_SMOKE_REPORT="$PWD/.tmp/native-library.json"` and `STUDIO_CATALOG_SMOKE_REPORT="$PWD/.tmp/native-catalog.json"`. This opt-in test downloads the CC0 ukulele if needed, saves it in the normal collection, renders it, and checks undo/redo, downloads through the separate catalog window and checks that the main Library updates, then records and rewinds a robot wave. Launching it again exercises restoration of the saved copy without downloading. It does not sign in or call a model.

To test a real agent edit, launch dev mode with `STUDIO_AGENT_SMOKE_REPORT="$PWD/.tmp/native-agent.json"` and sign in with ChatGPT in Studio. This explicitly opt-in test uses your selected model to add one traffic cone through Rixse, verifies that existing objects/cameras/performances remain intact, and leaves the cone visible. It consumes your ChatGPT plan usage. The browser integration test uses a provider fixture and does not call a model.

## What is included

- Asset library, GLB imports, animated performers, character and camera controls.
- Layered performance timeline, camera shots, splits, undo/redo, fade and wipe transitions.
- Landscape 16:9 and vertical 9:16 video framing, MP4/WebM and quality selection where supported by the host's webview.
- Native save dialogs for footage and scene ZIP exports. Unzip scene exports to get the footage folder.
- Sign in with ChatGPT, dynamically supplied model choices, streaming conversation, Stop and New chat.
- Automatic Rixse scene context and asset library metadata whenever the agent works. The current camera view is sent separately as a JPEG capped at 1024 pixels on its longest side. Object selection and projected screen positions connect references like “this light” to stable scene handles. Named anchors (camera foreground, near the selected character, alley center) and exact metre coordinates support placement without requiring markers.
- Typed Rixse actions to add library props/characters, load editable scene sets and move/delete props, with validation, collision checks, author attribution and global Undo/Redo. Mesh buffers, animation frames and local file contents stay local.

The inherited desktop search UI, menu-bar/tray app, global shortcuts, file crawler/index, Deka runtime, app generation, terminal, and Zega account/update services have been removed. The scene editor retains its movement and editing controls. See [editor controls and details](docs/editor.md).

## Current boundaries

ChatGPT can edit the live scene through Rixse actions, including while reviewing a paused timeline. It cannot generate/rig/animate assets or edit camera/performance clips yet. Its model list depends on the signed-in account and the provider's supported models. Credentials live in Studio's own OS credential vault; access tokens stay in the native process and are never exposed to the editor.

Conversations and scenes remain in memory for this prototype. Download a scene ZIP before closing when you want to preserve its assets and recorded footage; project import is not implemented yet. Video exports have no audio. Export codec support varies by the operating system's webview, and unsupported choices are disabled.

The browser preview can use the editor but cannot sign in with ChatGPT. Use Tauri dev mode for the complete desktop app.

## Rixse integration

The scene bridge uses Rixse `defineAction`, `createStore`, validation and `createWire`. The model reads compact entity handles plus the action vocabulary; `studio.apply_action` transports its proposal to the editor. Three.js projects accepted edits and retains asset geometry locally. Global edit transactions use Rixse state/undo with the existing bounded history providing redo. Character additions from the library and the agent use the same scene action; interactive object drags retain their preview behavior and commit through the global Rixse history.

The upstream npm name currently contains a placeholder release. `vendor/rixse` pins the real Apache-2.0 core from `rixsedev/rixse` commit `b4e71b42b90b8635a743838db747f5c5ddf134e3`; it is a local package dependency, not a rewritten copy.

## Origin and license

The desktop shell and ChatGPT provider are derived from [zegadb/studio](https://github.com/zegadb/studio), prototype commit `1e9e1b3`. The editor comes from [samifouad/worldbuilder](https://github.com/samifouad/worldbuilder), commit `c1ff2d8`. The source repositories remain intact.

Apache-2.0 for the desktop shell; the imported editor is MIT (see [editor/LICENSE](editor/LICENSE)). Third-party models and fonts retain their licenses. See [NOTICE](NOTICE) and [model attribution](editor/assets/ATTRIBUTION.md).
