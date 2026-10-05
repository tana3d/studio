# Studio distribution

Pushing a stable version tag such as `v0.1.0` runs **Studio distribution** on
the `studio-releases` self-hosted runner group. Bugsy builds Apple Silicon and
Intel Mac targets; Demon builds Linux x64 and handles validation/publication.
Windows releases are deferred until a Windows machine is available.
Normal branch pushes and pull requests run Public CI without releasing. The iMac is not registered for Studio. A manual run must select an
existing version tag; **publish=false** builds test installers without importing
signing credentials and never publishes them.

The tag defines the user-facing version: `v0.1.0` produces Studio `0.1.0` in
installers, filenames, the website and GitHub release notes. Build IDs retain the
run number, retry number and commit for traceability. Tags must use canonical
`vMAJOR.MINOR.PATCH` syntax without leading zeroes or prerelease suffixes. Version
components must be 0–65535 for the Windows installer. Lightweight and annotated
tags are supported. The tag must point to a commit on main; later commits on main
do not invalidate it. The complete pinned Python/Blender converter is bundled.
The workflow checks the converter, Rust tests and installer integrity. Published
macOS apps must have a Developer ID signature and a stapled Apple notarization
ticket. Linux uses AppImage.
macOS requires version 11 or newer, matching the bundled converter's minimum.
Intel builds on Bugsy require Rosetta and the x86_64 Rust target; their Python
and Blender binaries are Intel too. Linux bundles use an Ubuntu 24.04 container
on Demon to avoid raising the distribution baseline to its host OS.

All three installers, signed updater payloads and corresponding source archives must succeed. The publisher
checks artifact SHA-256 values, uploads to the private `tana-studio-releases` R2
bucket, and streams every object back to verify its bytes. It writes
`releases/<build-id>/manifest.json` before conditionally updating `latest.json`.
Failed or stale runs preserve the previous download. Interrupted uploads can
leave unused version directories; they never become the website's latest release.
Versions are compared numerically, so an older tag cannot replace a newer public
download. Deleted or moved tags cannot publish. Retrying an already published tag
reuses its immutable installers and can finish release notes after a failed GitHub
request; it never replaces the published bytes. Do not move an existing version
tag to another commit. Use a new version instead.

After R2 publication, the workflow creates a GitHub release with generated change
notes, version-specific download links, SHA-256 checksums and corresponding source
links. Existing owner-edited release notes are preserved on retry. Publishing jobs
are serialized; installer builds for different tags can run concurrently.

The website's RELEASES binding reads this manifest at request time. `/download`
and `/api/releases` show the current complete build; `/downloads/releases/...`
streams listed files, supports resumable downloads and retains old release links.
The website continues to deploy through Cloudflare's Git connection. Studio's
workflow uploads release objects only; it never deploys the website.

Repository variables: `R2_ACCOUNT_ID`, `R2_BUCKET`.
The `release` environment permits only tags matching `v*.*.*`. Its encrypted secrets
are `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (object read/write
for this bucket only), `APPLE_CERTIFICATE` (base64 Developer ID .p12),
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY` (Key ID), `APPLE_API_ISSUER`
(Issuer ID), `APPLE_API_PRIVATE_KEY` (.p8 contents), `TAURI_SIGNING_PRIVATE_KEY`
and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The updater key is separate from the
Apple certificate and never ships in the app. Apple ID plus an app-specific
password remains an optional fallback; never use the normal Apple password. Apple team ID is `6LV9UQMTRU`. Certificates are imported
into temporary job keychains, deleted after the macOS job. Existing host keychains
remain in the search list; cleanup removes only the job’s own keychain. No secrets are
available to Public CI, which runs on pushes and pull requests without selecting
the release environment. The release workflow runs on version-tag pushes and can
also be dispatched manually against an existing version tag. Only its publishing
job has repository write permission, to create the GitHub release record.

To release after merging changes to main (replace `v0.1.0` with the next version):

```sh
git fetch origin main
git tag -s v0.1.0 origin/main -m "Studio 0.1.0"
git push origin v0.1.0
```

The tag selects the exact source snapshot; the package and Tauri source version
do not need a separate version-bump commit. Rerun a failed workflow against the
same tag rather than deleting or recreating the tag.

Before the first public release, configure Apple secrets and run the workflow
with publication enabled. A passing dry run proves packaging but does not prove
Apple notarization or R2 publication. Release history and logs are at
https://github.com/tana3d/studio/actions/workflows/release.yml.
Trusted main checks and releases use the self-hosted machines. Pull-request
checks stay on GitHub-hosted runners so untrusted fork code cannot execute on
persistent personal machines. Those PR jobs may remain blocked by GitHub’s account
billing lock; the self-hosted release does not share that blocker.

Rollback: use an already verified version manifest to replace `latest.json` with
a conditional R2 write. Do not delete installer objects referenced by a published
manifest. The in-app updater accepts only newer versions.

## In-app updates

The Tauri updater checks `https://tana.gg/api/updates/<target>/<arch>/<version>`
after startup, every six hours, and when focused after an hour. Offline checks are
quiet. A small notice lets the user download with progress, then explicitly
confirm a restart. Downloading never installs or interrupts the current scene.
Scenes are currently in memory, so keep recordings before confirming a restart.
The separate catalog window cannot invoke updater or restart commands.

The website serves 204 when there is no newer compatible release, and 200 with
Tauri's version, date, notes, download URL and signature otherwise. It reads the
same atomic `latest.json` as the website button. macOS uses a signed `.app.tar.gz`;
Linux reuses the signed AppImage installer. Windows compatibility remains in
the website feed for future releases, but no Windows payload is published now. The release pipeline
verifies Minisign signatures and the version in their trusted comment before
publication; clients also require this signed version to match the update feed.
All update downloads use immutable version URLs and support resumable ranges.

The first updater-enabled version is 0.2.1. Older copies without the updater
must be replaced by downloading that version from the website. Future releases
use the same signing key and appear automatically. Back up the encrypted private
key and its password securely; losing this key prevents updates to existing apps.
A key change requires an intentionally planned transition, not regeneration.
