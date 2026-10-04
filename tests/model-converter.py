# SPDX-License-Identifier: GPL-3.0-or-later
"""Exercise the bundled runtime, real exporters, materials and animation."""
import hashlib
import json
import subprocess
import sys
import time
import zipfile
from pathlib import Path
import bpy

root = Path(__file__).resolve().parent.parent
fixtures = root / ".tmp/converter-fixtures"
fixtures.mkdir(parents=True, exist_ok=True)
(fixtures / "textures").mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
obj = bpy.context.object
obj.name = "Textured animated prop"
image = bpy.data.images.new("Colour texture", width=64, height=64)
image.pixels[:] = [.8, .04, .02, 1] * (64 * 64)
image.filepath_raw = str(fixtures / "textures/colour.png")
image.file_format = "PNG"
image.save()
image.filepath = "//textures/colour.png"
material = bpy.data.materials.new("Textured red")
material.use_nodes = True
texture = material.node_tree.nodes.new("ShaderNodeTexImage")
texture.image = image
material.node_tree.links.new(texture.outputs["Color"], material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
obj.data.materials.append(material)
obj.location = (0, 0, 1)
obj.keyframe_insert(data_path="location", frame=1)
obj.location = (2, 0, 1)
obj.keyframe_insert(data_path="location", frame=25)
obj.animation_data.action.name = "Walk"
marker = fixtures / "embedded-script-ran"
marker.unlink(missing_ok=True)
script = bpy.data.texts.new("unsafe_startup.py")
script.use_module = True
script.write("from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('unsafe')")
bpy.ops.wm.save_as_mainfile(filepath=str(fixtures / "textured.blend"))
bpy.ops.wm.obj_export(filepath=str(fixtures / "prop.obj"))
bpy.ops.wm.stl_export(filepath=str(fixtures / "prop.stl"))
bpy.ops.wm.ply_export(filepath=str(fixtures / "prop.ply"))
bpy.ops.export_scene.fbx(filepath=str(fixtures / "animated.fbx"), path_mode="COPY", embed_textures=True)
bpy.ops.wm.usd_export(filepath=str(fixtures / "prop.usdc"))
bpy.ops.export_scene.gltf(filepath=str(fixtures / "prop.gltf"), export_format="GLTF_SEPARATE")
with zipfile.ZipFile(fixtures / "textured.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for file in [fixtures / "textured.blend", fixtures / "textures/colour.png"]:
        archive.write(file, str(Path("asset") / file.relative_to(fixtures)))
original_hash = hashlib.sha256((fixtures / "textured.blend").read_bytes()).hexdigest()
results = []
for filename in ["textured.blend", "animated.fbx", "prop.obj", "prop.stl", "prop.ply", "prop.gltf", "prop.usdc"]:
    target = fixtures / filename.replace(".", "-")
    target.mkdir(exist_ok=True)
    started = time.monotonic()
    with (target / "log.txt").open("wb") as log:
        subprocess.run([sys.executable, "-I", str(root / "src-tauri/converter/convert.py"), str(fixtures / filename), str(target / "model.glb"), str(target / "result.json")], stdout=log, stderr=log, check=True, timeout=120)
    result = json.loads((target / "result.json").read_text())
    assert result["ok"], result
    raw = (target / "model.glb").read_bytes()
    doc = json.loads(raw[20:20+int.from_bytes(raw[12:16], "little")])
    assert doc.get("meshes"), filename
    assert all(not image.get("uri") for image in doc.get("images", [])), filename
    if filename in ["textured.blend", "prop.gltf", "animated.fbx"]:
        assert doc.get("animations"), filename
        assert doc.get("images"), filename
    results.append({"file": filename, "seconds": round(time.monotonic()-started, 2), "images": len(doc.get("images", [])), "animations": len(doc.get("animations", [])), "bytes": len(raw)})
assert not marker.exists(), "Embedded Python must not execute"
assert hashlib.sha256((fixtures / "textured.blend").read_bytes()).hexdigest() == original_hash
# Removing a required texture produces a clear failure, not an untextured model.
(fixtures / "textures/colour.png").rename(fixtures / "textures/hidden.png")
try:
    failed = fixtures / "missing.json"
    with (fixtures / "missing.log").open("wb") as log:
        process = subprocess.run([sys.executable, "-I", str(root / "src-tauri/converter/convert.py"), str(fixtures / "textured.blend"), str(fixtures / "missing.glb"), str(failed)], stdout=log, stderr=log, timeout=120)
    assert process.returncode != 0
    assert "texture is missing" in json.loads(failed.read_text())["error"]
finally:
    (fixtures / "textures/hidden.png").rename(fixtures / "textures/colour.png")
print(json.dumps({"ok": True, "formats": results, "originalUntouched": True, "embeddedScriptsDisabled": True, "missingTexturesRejected": True}, indent=2))
