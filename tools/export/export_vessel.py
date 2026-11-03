"""Export a vessel (or fauna) FBX from the game repo to a glTF binary for the screensaver.

Run with Blender's Python module (pip install bpy; Blender 5.2 LTS is what M0 used):

    python tools/export/export_vessel.py --game-repo ../Cosmic-Shore --name squirrel \
        --fbx "Assets/_Models/Vessel Models/SquirrelVessel_CosmicShoresTest1.fbx"

What it keeps: the skinned hull, its armature, its material SLOT NAMES (Body, Domain, Engine,
Window - the screensaver rebuilds its own materials from them, it never ships the game's
shaders) and the element shape keys. The artist "takes" are one-frame poses, kept as glTF
animations so a later milestone can blend them (pitch, roll, yaw, speed).

What it drops: textures (the vessels have none), cameras, lights, the game's material values.
"""
import argparse
import os
import sys

import bpy


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-repo", required=True)
    ap.add_argument("--fbx", required=True, help="path inside the game repo")
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "public", "content"))
    ap.add_argument("--no-anim", action="store_true")
    a = ap.parse_args(argv)

    src = os.path.join(a.game_repo, a.fbx)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=src)

    for o in [o for o in bpy.data.objects if o.type not in ("MESH", "ARMATURE", "EMPTY")]:
        bpy.data.objects.remove(o)

    os.makedirs(a.out, exist_ok=True)
    out = os.path.abspath(os.path.join(a.out, f"{a.name}.glb"))
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_texcoords=False,
        export_normals=True,
        export_materials="EXPORT",
        export_morph=True,
        export_skins=True,
        export_animations=not a.no_anim,
        export_cameras=False,
        export_lights=False,
    )
    tris = 0
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    print(f"wrote {out} ({os.path.getsize(out):,} bytes, {tris:,} tris)")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
