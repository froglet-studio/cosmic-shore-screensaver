"""Export the Garland environment (the Home screen's world) as a binary instance buffer.

    python3 tools/export/export_garland.py --game-repo ../Cosmic-Shore

The game repo already carries an exact offline model of the shipped generator,
Tools/Build/author_garland_cell.py, kept honest against SpawnableGarland.cs by its own --check
(count, kinds, per-domain volume, and the source hashes in garland_measurements.json). This
script runs THAT model unchanged and writes what it lays. It refuses to export if the model's
prism count disagrees with the committed measurement of the shipped C#.

Output (public/content/):
  garland.bin   little-endian; N records of 10 float32 = position xyz, quaternion xyzw, scale xyz
                (40 bytes each), then N uint8 domain ids, then N uint8 kind ids.
  garland.json  count, domain/kind tables, offsets, and the provenance (game commit, source hash).

Coordinates are converted from Unity (left-handed, +z forward) to three.js (right-handed): z is
negated, and each rotation basis is mirrored the same way (M' = S M S, S = diag(1, 1, -1)).
"""
import argparse
import hashlib
import json
import math
import os
import struct
import subprocess
import sys

DOMAINS = ["Jade", "Ruby", "Blue", "Gold"]       # index = id in the buffer (game ids are 1..4)
KINDS = ["Plain", "Shielded", "SuperShielded", "Danger"]


def basis_to_quat(x, y, z):
    # rows of the rotation matrix whose COLUMNS are the basis vectors x, y, z
    m00, m01, m02 = x[0], y[0], z[0]
    m10, m11, m12 = x[1], y[1], z[1]
    m20, m21, m22 = x[2], y[2], z[2]
    tr = m00 + m11 + m22
    if tr > 0:
        s = 0.5 / math.sqrt(tr + 1.0)
        return ((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s)
    if m00 > m11 and m00 > m22:
        s = 2.0 * math.sqrt(1.0 + m00 - m11 - m22)
        return (0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    if m11 > m22:
        s = 2.0 * math.sqrt(1.0 + m11 - m00 - m22)
        return ((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    s = 2.0 * math.sqrt(1.0 + m22 - m00 - m11)
    return ((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)


def to_three(pos, basis):
    flip = lambda v: (v[0], v[1], -v[2])
    x, y, z = basis
    # S M S: mirror each basis vector, and negate the z column
    return flip(pos), (flip(x), flip(y), tuple(-c for c in flip(z)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-repo", required=True)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "public", "content"))
    a = ap.parse_args()
    repo = os.path.abspath(a.game_repo)

    sys.path.insert(0, os.path.join(repo, "Tools", "Build"))
    saved = sys.argv
    sys.argv = ["author_garland_cell.py"]
    import author_garland_cell as g  # noqa: E402  (the game repo's own model, unchanged)
    sys.argv = saved

    build = g.build_environment()
    lays = build.lays
    measured = json.load(open(os.path.join(repo, "Tools", "Build", "garland_measurements.json")))
    if len(lays) != measured["count"]:
        sys.exit(f"model lays {len(lays)} prisms but the shipped generator measured {measured['count']}; "
                 "run the game repo's garland harness / --check first")

    floats, doms, kinds = [], [], []
    for pos, basis, scale, dom, kind, _family in lays:
        p, b = to_three(pos, basis)
        q = basis_to_quat(*b)
        n = math.sqrt(sum(c * c for c in q))
        q = tuple(c / n for c in q)
        floats += [*p, *q, *scale]
        doms.append(DOMAINS.index(dom))
        kinds.append(KINDS.index(kind))

    os.makedirs(a.out, exist_ok=True)
    blob = struct.pack(f"<{len(floats)}f", *floats) + bytes(doms) + bytes(kinds)
    open(os.path.join(a.out, "garland.bin"), "wb").write(blob)

    src = os.path.join(repo, "Assets/_Scripts/Controller/Environment/MiniGameObjects/SpawnableGarland.cs")
    try:
        commit = subprocess.check_output(["git", "-C", repo, "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        commit = "unknown"
    meta = {
        "count": len(lays),
        "stride_floats": 10,
        "domain_offset": len(floats) * 4,
        "kind_offset": len(floats) * 4 + len(lays),
        "domains": DOMAINS,
        "kinds": KINDS,
        "source": {
            "game_commit": commit,
            "generator": "Assets/_Scripts/Controller/Environment/MiniGameObjects/SpawnableGarland.cs",
            "generator_sha256": hashlib.sha256(open(src, "rb").read()).hexdigest(),
            "model": "Tools/Build/author_garland_cell.py",
        },
    }
    json.dump(meta, open(os.path.join(a.out, "garland.json"), "w"), indent=2)
    print(f"wrote garland.bin ({len(blob):,} bytes, {len(lays):,} prisms) from game commit {commit[:9]}")


if __name__ == "__main__":
    main()
