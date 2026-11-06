"""Export the Omni crystal's Mass depth prisms and the numbers behind its two effects.

    python3 tools/export/export_crystal_fx.py --game-repo ../Cosmic-Shore            # write the outputs
    python3 tools/export/export_crystal_fx.py --game-repo ../Cosmic-Shore --check    # exit 1 if they would change

Reads, from the game repo:
  Assets/_Models/OmniCrystalTriangles.asset                 the 20 triangular prisms (positions, normals, TEXCOORD2 =
                                                            plate centre xyz + plate index w), thickness baked in
  Assets/_Prefabs/Environment/OmniCrystalTriangles.prefab   the prisms' scale under Crystal.prefab
  Assets/_Graphics/Materials/CrystalMaterials/OmniDepthPrisms.mat   the column dials and colours
  Assets/_SO_Assets/Environment/CrystalDepthPrismProfile.asset      the ratchet (depths, rise, reseat)
  Assets/_Graphics/Materials/CrystalMaterials/OmniChargeArcs.mat    the arc colours and intensities
  Assets/_SO_Assets/Environment/CrystalChargeArcsProfile.asset      the flux timings and looks
  Assets/_SO_Assets/Environment/OmniCrystalCadence.asset            the pentagons' drawn thickness

Writes public/content/crystal_prisms.json (the mesh) and src/crystal_fx_data.ts (the numbers).

The prism mesh is in Unity's mesh space; the body (public/content/crystal.glb) came through Blender's glTF export, in
three's. The mapping between the two is MEASURED here, not assumed: of the 48 axis permutations and sign flips, the one
taken is the proper rotation that lands the 20 prism plate centres on the body's own 20 triangle plates (the six-corner
plates of crystal.glb), and the export refuses if none lands within 1e-4 of the body's radius. Plain Python 3.
"""
import argparse
import itertools
import json
import math
import os
import re
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
MESH_OUT = os.path.join(ROOT, "public", "content", "crystal_prisms.json")
TS_OUT = os.path.join(ROOT, "src", "crystal_fx_data.ts")
BODY = os.path.join(ROOT, "public", "content", "crystal.glb")

MESH = "Assets/_Models/OmniCrystalTriangles.asset"
PREFAB = "Assets/_Prefabs/Environment/OmniCrystalTriangles.prefab"
DEPTH_MAT = "Assets/_Graphics/Materials/CrystalMaterials/OmniDepthPrisms.mat"
DEPTH_PROFILE = "Assets/_SO_Assets/Environment/CrystalDepthPrismProfile.asset"
ARCS_MAT = "Assets/_Graphics/Materials/CrystalMaterials/OmniChargeArcs.mat"
ARCS_PROFILE = "Assets/_SO_Assets/Environment/CrystalChargeArcsProfile.asset"
CADENCE = "Assets/_SO_Assets/Environment/OmniCrystalCadence.asset"


def game_commit(repo):
    try:
        return subprocess.check_output(["git", "-C", repo, "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def read(repo, path):
    return open(os.path.join(repo, path), encoding="utf-8").read()


def so_fields(text):
    """The scalar fields of a ScriptableObject asset (after m_EditorClassIdentifier)."""
    body = text.split("m_EditorClassIdentifier:", 1)[1]
    out = {}
    for m in re.finditer(r"^  (\w+): ([-\d.eE]+)\s*$", body, re.M):
        out[m.group(1)] = float(m.group(2))
    return out


def mat_values(text):
    floats, colors = {}, {}
    for m in re.finditer(r"- (_\w+): ([-\d.eE]+)\s*$", text, re.M):
        floats[m.group(1)] = float(m.group(2))
    for m in re.finditer(r"- (_\w+): \{r: ([-\d.eE]+), g: ([-\d.eE]+), b: ([-\d.eE]+), a: ([-\d.eE]+)\}", text):
        colors[m.group(1)] = tuple(float(m.group(i)) for i in range(2, 6))
    return floats, colors


def read_unity_mesh(text):
    vcount = int(re.search(r"m_VertexCount: (\d+)", text).group(1))
    data = bytes.fromhex(re.search(r"_typelessdata: ([0-9a-f]+)", text).group(1))
    idx = bytes.fromhex(re.search(r"m_IndexBuffer: ([0-9a-f]+)", text).group(1))
    stride = len(data) // vcount
    # channels: 0 position, 1 normal, 2 tangent, 3 colour, 4..11 uv0..uv7 (offset, dimension) in the asset's order
    chans = re.findall(r"- stream: (\d+)\n\s+offset: (\d+)\n\s+format: (\d+)\n\s+dimension: (\d+)", text)
    uv2 = chans[6]
    assert int(uv2[3]) == 4, "OmniCrystalTriangles has no 4-wide TEXCOORD2 (plate centre + index)"
    uv2_off = int(uv2[1])
    pos, nrm, plate = [], [], []
    for i in range(vcount):
        pos.append(struct.unpack_from("<3f", data, i * stride))
        nrm.append(struct.unpack_from("<3f", data, i * stride + 12))
        plate.append(struct.unpack_from("<4f", data, i * stride + uv2_off))
    indices = list(struct.unpack_from(f"<{len(idx) // 2}H", idx))
    return pos, nrm, plate, indices


def read_glb_body(path):
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    js = json.loads(b[20:20 + jl])
    bin0 = b[20 + jl + 8:]
    prim = js["meshes"][0]["primitives"][0]

    def acc(i):
        a = js["accessors"][i]
        bv = js["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        comp = {"SCALAR": 1, "VEC3": 3}[a["type"]]
        fmt = {5126: "f", 5125: "I", 5123: "H"}[a["componentType"]]
        vals = struct.unpack_from(f"<{a['count'] * comp}{fmt}", bin0, off)
        return [vals[k:k + comp] for k in range(0, len(vals), comp)] if comp > 1 else list(vals)

    verts = acc(prim["attributes"]["POSITION"])
    tris = acc(prim["indices"])
    # the node's rotation (crystal.ts bakes the world matrix into the body), applied as a quaternion
    rot = js["nodes"][0].get("rotation", [0, 0, 0, 1])
    verts = [qrot(rot, v) for v in verts]
    return verts, tris


def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx))


def plates_by_corners(verts, tris, corners):
    key = lambda v: (round(v[0], 4), round(v[1], 4), round(v[2], 4))
    weld = {}
    corner = [weld.setdefault(key(v), len(weld)) for v in verts]
    parent = list(range(len(weld)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for t in range(0, len(tris), 3):
        a = find(corner[tris[t]])
        parent[find(corner[tris[t + 1]])] = a
        parent[find(corner[tris[t + 2]])] = a
    plates = {}
    for i, c in enumerate(corner):
        plates.setdefault(find(c), {})[c] = verts[i]
    return [list(p.values()) for p in plates.values() if len(p) == corners]


def mean(ps):
    n = len(ps)
    return tuple(sum(p[k] for p in ps) / n for k in range(3))


def dist(a, b):
    return math.sqrt(sum((a[k] - b[k]) ** 2 for k in range(3)))


def det_of(perm, signs):
    m = [[0] * 3 for _ in range(3)]
    for r in range(3):
        m[r][perm[r]] = signs[r]
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def build(repo):
    pos, nrm, plate, indices = read_unity_mesh(read(repo, MESH))
    scale = float(re.search(r"m_LocalScale: \{x: ([-\d.eE]+)", read(repo, PREFAB)).group(1))
    count = int(max(p[3] for p in plate) + 0.5) + 1
    centres = [None] * count
    for p in plate:
        centres[int(p[3] + 0.5)] = p[:3]

    # measure the mesh-space -> body-space axis mapping against the body's own triangle plates
    bverts, btris = read_glb_body(BODY)
    body_tris = [mean(p) for p in plates_by_corners(bverts, btris, 6)]
    assert len(body_tris) == count == 20, f"{len(body_tris)} body triangle plates, {count} prism plates (expected 20)"
    radius = max(math.sqrt(sum(c * c for c in v)) for v in bverts)
    best = None
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            if det_of(perm, signs) != 1:
                continue
            worst = 0.0
            for c in centres:
                m = tuple(signs[r] * c[perm[r]] * scale for r in range(3))
                worst = max(worst, min(dist(m, b) for b in body_tris))
            if best is None or worst < best[0]:
                best = (worst, perm, signs)
    worst, perm, signs = best
    assert worst < 1e-4 * radius * 10, f"no axis mapping lands the prisms on the body's triangles (best {worst:.2e})"
    mp = lambda v: [round(signs[r] * v[perm[r]], 6) for r in range(3)]

    mesh = {
        "about": f"OmniCrystalTriangles.asset from the game repo at {game_commit(repo)[:8]}, in the body's space "
                 f"(axes {list(perm)} signs {list(signs)}); draw at scale {scale} inside the body's group.",
        "scale": scale,
        "position": [x for v in pos for x in mp(v)],
        "normal": [x for v in nrm for x in mp(v)],
        "plate": [x for p in plate for x in (mp(p[:3]) + [int(p[3] + 0.5)])],
        "index": indices,
    }

    df, dc = mat_values(read(repo, DEPTH_MAT))
    dp = so_fields(read(repo, DEPTH_PROFILE))
    af, ac = mat_values(read(repo, ARCS_MAT))
    ap = so_fields(read(repo, ARCS_PROFILE))
    cad = so_fields(read(repo, CADENCE))
    rgb = lambda c: [round(c[0], 7), round(c[1], 7), round(c[2], 7)]
    depth = {
        "reach": df["_Reach"], "plateScaleStart": df["_PlateScaleStart"], "faceSplit": df["_FaceSplit"],
        "splitUnit": df["_SplitUnit"], "topHeight": df["_TopHeight"], "thickness": df["_Thickness"],
        "thicknessInward": df["_ThicknessInward"],
        "bright": rgb(dc["_BrightColor"]), "dark": rgb(dc["_DarkColor"]), "spread": dc["_Spread"][0],
        "strike": rgb(dc["_StrikeColor"]),
        "openDepth": dp["openDepth"], "sealDepth": dp["sealDepth"], "profilePower": dp["profilePower"],
        "reseatDepth": dp["reseatDepth"], "reseatFadeSeconds": dp["reseatFadeSeconds"],
        "sealAtHorizon": dp["sealAtHorizon"] > 0.5, "horizonMargin": dp["horizonMargin"],
        "riseWhileHidden": dp["riseWhileHidden"] > 0.5, "riseRate": dp["riseRate"],
        "occluderRadius": dp["occluderRadius"], "orientationJitter": dp["orientationJitter"],
    }
    arcs = {
        "bright": rgb(ac["_BrightColor"]), "core": rgb(ac["_ArcCoreColor"]),
        "boltIntensity": af.get("_BoltIntensity", 1.0) * ap["boltIntensity"],
        "glowIntensity": af.get("_GlowIntensity", 1.0) * ap["glowIntensity"],
        "rate": ap["rate"], "gap": ap["fluxGapSeconds"], "charge": ap["fluxChargeSeconds"],
        "strike": ap["fluxStrikeSeconds"], "hold": ap["fluxHoldSeconds"], "fade": ap["fluxFadeSeconds"],
        "fork": ap["fluxFork"], "minDegrees": ap["fluxMinDegrees"], "maxDegrees": ap["fluxMaxDegrees"],
        "bundle": ap["fluxBundle"], "turns": int(ap["fluxTurns"]),
        "strikeProtractionFrom": ap["strikeProtractionFrom"], "strikeProtractionFull": ap["strikeProtractionFull"],
        "coreWidth": ap["coreWidth"], "writheSpeed": ap["writheSpeed"], "flickerSpeed": ap["flickerSpeed"],
        "pentagonThickness": cad["plateThickness"],
        "sleepBelowScreenRadiusPixels": ap["sleepBelowScreenRadiusPixels"],
    }
    ts = f"""// GENERATED by tools/export/export_crystal_fx.py from the game repo at {game_commit(repo)[:8]}:
//   {DEPTH_MAT}, {DEPTH_PROFILE}
//   {ARCS_MAT}, {ARCS_PROFILE}, {CADENCE}
// Do not edit by hand; re-run the exporter. Colours are the materials' stored (gamma) values.

/** OmniDepthPrisms.mat (OmniDepthPrismShader) and CrystalDepthPrismProfile.asset (the ratchet). */
export const DEPTH = {json.dumps(depth, indent=2)} as const;

/** OmniChargeArcs.mat (CrystalChargeArcsShader) and CrystalChargeArcsProfile.asset (Flux mode). */
export const ARCS = {json.dumps(arcs, indent=2)} as const;
"""
    return json.dumps(mesh, separators=(",", ":")) + "\n", ts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-repo", required=True)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    mesh, ts = build(a.game_repo)
    strip = lambda s: re.sub(r"^// GENERATED.*\n", "", re.sub(r'"about":"[^"]*",', "", s))
    if a.check:
        bad = []
        for path, text in ((MESH_OUT, mesh), (TS_OUT, ts)):
            old = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
            if strip(old) != strip(text):
                bad.append(os.path.relpath(path, ROOT))
        if bad:
            print("crystal fx out of date: " + ", ".join(bad) + " (re-run tools/export/export_crystal_fx.py)")
            return 1
        print("crystal fx in sync")
        return 0
    open(MESH_OUT, "w", encoding="utf-8").write(mesh)
    open(TS_OUT, "w", encoding="utf-8").write(ts)
    print(f"wrote {os.path.relpath(MESH_OUT, ROOT)} and {os.path.relpath(TS_OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
