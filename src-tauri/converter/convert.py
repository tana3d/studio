# SPDX-License-Identifier: GPL-3.0-or-later
"""Studio's local Blender conversion entry point; no user scripts are executed."""
import json
import os
import sys
from pathlib import Path


def convert(source, output):
    import bpy

    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    suffix = source.suffix.lower()
    warnings = []
    if suffix == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
        bpy.context.preferences.filepaths.use_scripts_auto_execute = False
        if any(mod.type == "NODES" for obj in bpy.context.scene.objects for mod in obj.modifiers):
            warnings.append("Geometry Nodes are exported as evaluated geometry; their controls remain in the original Blender file.")
        if any(obj.animation_data and obj.animation_data.drivers for obj in bpy.data.objects):
            warnings.append("Python animation drivers are disabled during import.")
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(source))
    elif suffix in (".gltf", ".glb"):
        if suffix == ".gltf":
            doc = json.loads(source.read_text())
            for item in doc.get("buffers", []) + doc.get("images", []):
                uri = item.get("uri", "")
                if uri and not uri.startswith("data:"):
                    from urllib.parse import unquote, urlparse
                    if urlparse(uri).scheme or uri.startswith(("//", "\\")):
                        raise ValueError("The model references a remote resource. Download its textures and buffers first.")
                    resource = (source.parent / unquote(uri)).resolve()
                    if not resource.is_relative_to(source.parent.resolve()) or not resource.is_file():
                        raise ValueError("Keep the glTF buffers and textures beside the model or inside its asset folder.")
        bpy.ops.import_scene.gltf(filepath=str(source))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(source))
    elif suffix == ".stl":
        bpy.ops.wm.stl_import(filepath=str(source))
    elif suffix == ".ply":
        bpy.ops.wm.ply_import(filepath=str(source))
    elif suffix in (".usd", ".usda", ".usdc", ".usdz"):
        bpy.ops.wm.usd_import(filepath=str(source), import_usd_preview=True)
    else:
        raise ValueError("This model format is not supported by the local converter.")

    if not any(obj.type in ("MESH", "CURVE", "SURFACE", "FONT", "META") for obj in bpy.context.scene.objects):
        raise ValueError("The file does not contain a model in its active scene.")
    # Report missing source textures rather than saving a misleading white model.
    materials = {slot.material for obj in bpy.context.scene.objects for slot in obj.material_slots if slot.material}
    procedural = False
    for material in materials:
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                image = node.image
                if image.source == "FILE" and not image.packed_file and not Path(bpy.path.abspath(image.filepath, library=image.library)).is_file():
                    raise ValueError("A texture is missing: " + image.name + ". Keep the downloaded textures with the model, or pack them into the Blender file.")
            if node.type in ("TEX_NOISE", "TEX_VORONOI", "TEX_MUSGRAVE", "TEX_WAVE", "TEX_MAGIC", "TEX_BRICK", "GROUP"):
                procedural = True
    if procedural:
        warnings.append("Some procedural materials may look different. Bake them to image textures in Blender for an exact appearance.")

    shape_keys = any(obj.type == "MESH" and obj.data.shape_keys for obj in bpy.context.scene.objects)
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format="GLB", use_selection=False,
        export_cameras=False, export_lights=False, export_animations=True,
        export_animation_mode="ACTIONS", export_skins=True, export_morph=True,
        export_apply=not shape_keys, export_yup=True,
    )
    if not output.is_file() or output.stat().st_size < 20:
        raise ValueError("Blender did not produce a usable model.")
    if suffix == ".blend":
        # A portable editable copy; never overwrite the user's source project.
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(output.parent / "source.blend"), copy=True)
    return {"ok": True, "warnings": warnings, "blender": bpy.app.version_string}


if __name__ == "__main__":
    report = Path(sys.argv[3])
    try:
        result = convert(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
    except Exception as error:
        result = {"ok": False, "error": str(error)[:2000]}
    report.write_text(json.dumps(result), encoding="utf-8")
    sys.exit(0 if result["ok"] else 1)
