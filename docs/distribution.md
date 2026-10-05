# Studio distribution

Pushing a stable version tag such as `v0.1.0` runs **Studio distribution** on
GitHub-hosted runners for Apple Silicon, Intel Mac, Windows x64 and Linux x64.
Normal branch pushes and pull requests run Public CI without releasing. No
publishing agent or build runs on a user's computer. A manual run must select an
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
ticket. Windows uses an NSIS installer; Linux uses AppImage.
macOS requires version 11 or newer, matching the bundled converter's minimum.
Windows installers are currently unsigned; no Windows signing certificate is
configured. Linux builds use the Ubuntu 24.04 runner.

All four installers and corresponding source archives must succeed. The publisher
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
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific Apple
notarization password). Apple team ID is `6LV9UQMTRU`. Certificates are imported
into temporary runner keychains, deleted after the macOS job. No secrets are
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
GitHub-hosted builds also require the organization/account to be in good billing
standing; a billing lock prevents jobs from starting, even before checkout.

Rollback: use an already verified version manifest to replace `latest.json` with
a conditional R2 write. Do not delete installer objects referenced by a published
manifest. Automatic in-app updates are separate future work; this pipeline serves
fresh installers from the website.
