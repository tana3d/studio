# Studio model converter

Studio runs Blender as a separate local Python process. The converter script is
GPL-3.0-or-later. Studio's Rust shell and editor keep their existing licences.

The generated runtime uses the unmodified Blender Foundation `bpy` 4.5.14 package:
https://pypi.org/project/bpy/4.5.14/

Blender's corresponding source is available at:
https://download.blender.org/source/blender-4.5.14.tar.xz

Release distributors must provide the corresponding source alongside the
converter binary downloads, including this script and any build changes. A link
to this document alone is not a replacement for that distribution obligation.

The Python runtime is from the pinned python-build-standalone release:
https://github.com/astral-sh/python-build-standalone/releases/tag/20261003

Python and dependency licence notices remain in the generated runtime. Its
`studio-runtime.json` records platform, versions, source and binary checksums.
