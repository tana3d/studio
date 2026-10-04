# Security Policy

Security fixes are provided for the latest version of Tana Studio.

Please use [GitHub private vulnerability reporting](https://github.com/tana3d/studio/security/advisories/new) for suspected vulnerabilities. Do not post credentials or personal scene data in a public issue.

Studio does not crawl or index the computer. Native file writes require a save dialog. ChatGPT credentials stay in the OS vault/native process. When a user sends a chat request, current scene state, selected object, camera-view snapshot and library metadata are automatically shared with ChatGPT through compact Rixse context. Raw model/animation buffers and local file contents are not sent. Agent edits use the typed Rixse vocabulary; generated JavaScript is never executed.
