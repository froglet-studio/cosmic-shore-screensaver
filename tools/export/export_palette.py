"""Export the game's colour sets into src/palette.ts (and the hosts' lists of them).

    python3 tools/export/export_palette.py --game-repo ../Cosmic-Shore            # write the files
    python3 tools/export/export_palette.py --game-repo ../Cosmic-Shore --check    # exit 1 if any would change

Every unlocked entry of the game's ColorSetCatalog.asset (Nocturne, Photic, Dart Frog, Nacre, the vision sets, ...)
becomes a set the screensaver can wear. Each set carries:

- its four domain blocks (prism rims and faces, hull, trail), the fields the game paints its domain materials with;
- its TRACED colours for the materials the screensaver copies from the game (the sky, the nucleus cage, the
  membrane, the crystal and its effects). Since 2026-11-10 the game repaints every material colour from the worn set
  (Docs/VesselModels/COLOR_TRACE.md in the game repo, "the colour trace"): a colour is found by its id, its authored
  value as role:RRGGBB, and takes the worn set's value for that id. This does the same lookup offline, so the
  screensaver needs no trace logic at runtime. A colour no set retraces (white, black, the crystal's element shades)
  is left out and the screensaver keeps the authored value.

The default is the set the game actually paints with: the one Assets/_SO_Assets/ThemeManagerDataContainer.asset
names in its ColorSet field (Nocturne since 2026-11-03).

Writes:
  src/palette.ts                          the sets (data only; src/colours.ts picks the worn one)
  host/windows/src/colour_sets.h          the ids and names the Windows settings dialog lists
  host/macos/Sources/ColourSets.swift     the same for the macOS sheet (only when host/macos exists)

Plain Python 3, no dependencies. Never edit the outputs by hand.
"""
import argparse
import math
import os
import re
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_TS = os.path.join(ROOT, "src", "palette.ts")
OUT_H = os.path.join(ROOT, "host", "windows", "src", "colour_sets.h")
MAC_DIR = os.path.join(ROOT, "host", "macos", "Sources")
OUT_SWIFT = os.path.join(MAC_DIR, "ColourSets.swift")

THEME = "Assets/_SO_Assets/ThemeManagerDataContainer.asset"
CATALOG = "Assets/_SO_Assets/Color Palettes/ColorSetCatalog.asset"
AUTHORED_SET = "photic"  # ColorTrace.AuthoredSetId: the set the game's materials were authored in

# screensaver order (index = domain id in garland.bin): Jade, Ruby, Blue, Gold
DOMAINS = ["Jade", "Ruby", "Blue", "Gold"]
# screensaver field -> SO_ColorSet field
FIELDS = [
    ("inside", "InsideBlockColor", "rim, HDR, > 1 blooms"),
    ("outside", "OutsideBlockColor", "base face"),
    ("superInside", "SuperShieldedInsideBlockColor", ""),
    ("superOutside", "SuperShieldedOutsideBlockColor", ""),
    ("ship1", "ShipColor1", "hull body"),
    ("ship2", "ShipColor2", "domain trim"),
    ("trail", "TrailHighlightColor", ""),
]

# The material colours the screensaver draws, by the key src/ reads them with. Directions stored as colours
# (the sky's _CoreDirection, ...) are not colours and are never listed.
SKY = "Assets/_Graphics/Skyboxes/HyperSeaSkybox.mat"
MATERIALS = {
    "sky": (SKY, None),  # every colour property of the sky material
    "cage": ("Assets/_Graphics/Materials/CageMaterial.mat", ["_Edge_Color", "_Straight_Color", "_Nucleus_Dark"]),
    "membrane": ("Assets/_Graphics/Materials/SpindleMaterial.mat", ["_DullColor", "_BrightColor"]),
    "omni": ("Assets/_Graphics/Materials/CrystalMaterials/OmniCrystalBody.mat",
             ["_BrightColor", "_DarkColor", "_ChargeColor", "_MassColor", "_SpaceColor", "_TimeColor"]),
    "depth": ("Assets/_Graphics/Materials/CrystalMaterials/OmniDepthPrisms.mat",
              ["_BrightColor", "_DarkColor", "_StrikeColor"]),
    "arcs": ("Assets/_Graphics/Materials/CrystalMaterials/OmniChargeArcs.mat", ["_BrightColor", "_ArcCoreColor"]),
}

COLOR_RE = re.compile(r"^\s+(\w+): \{r: ([-\d.eE]+), g: ([-\d.eE]+), b: ([-\d.eE]+), a: ([-\d.eE]+)\}")
GUID_RE = re.compile(r"guid: ([0-9a-f]{32})")
TRACED_RE = re.compile(r"Id: (\S+)\n\s+Color: \{r: ([-\d.eE]+), g: ([-\d.eE]+), b: ([-\d.eE]+)")


def unfold(text):
    # Unity folds long flow mappings onto a second line ("{r: 0.03, g: 0.2, b: 0.36,\n      a: 1}")
    return re.sub(r",\r?\n\s+", ", ", text.replace("\r\n", "\n"))


def find_by_guid(repo, guid):
    out = subprocess.run(["git", "-C", repo, "grep", "-l", f"guid: {guid}", "--", "*.asset.meta"],
                         capture_output=True, text=True).stdout.split("\n")
    metas = [m for m in out if m.endswith(".asset.meta")]
    if len(metas) != 1:
        sys.exit(f"export_palette: expected one asset with guid {guid}, found {metas}")
    return metas[0][: -len(".meta")]


def live_guid(repo):
    for line in open(os.path.join(repo, THEME), encoding="utf-8"):
        if line.strip().startswith("ColorSet:"):
            return GUID_RE.search(line).group(1)
    sys.exit(f"export_palette: no ColorSet field in {THEME}")


def unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] == "'":
        return v[1:-1].replace("''", "'")
    if len(v) >= 2 and v[0] == v[-1] == '"':
        return v[1:-1]
    return v


def read_catalog(repo):
    """The catalog's entries in order: id, guid, displayName, line, unlocked, vision."""
    text = unfold(open(os.path.join(repo, CATALOG), encoding="utf-8").read())
    entries = []
    for block in re.split(r"\n  - id: ", text)[1:]:
        e = {"id": block.split("\n", 1)[0].strip()}
        for key in ("displayName", "line", "unlocked", "vision"):
            m = re.search(rf"^    {key}: (.*)$", block, re.M)
            e[key] = unquote(m.group(1)) if m else ""
        e["guid"] = GUID_RE.search(block).group(1)
        entries.append(e)
    if not entries:
        sys.exit(f"export_palette: no entries in {CATALOG}")
    return entries


def read_set(path):
    text = unfold(open(path, encoding="utf-8").read())
    head, _, traced_text = text.partition("TracedColors:")
    domains, current = {}, None
    for line in head.split("\n"):
        m = re.match(r"^  (\w+)Colors:\s*$", line)
        if m:
            current = m.group(1) if m.group(1) in DOMAINS else None
            if current:
                domains[current] = {}
            continue
        m = COLOR_RE.match(line)
        if m and current:
            domains[current][m.group(1)] = tuple(float(v) for v in m.group(2, 3, 4))
    missing = [d for d in DOMAINS if d not in domains]
    if missing:
        sys.exit(f"export_palette: {path} has no {missing}")
    traced = {m[0]: tuple(float(v) for v in m[1:4]) for m in TRACED_RE.findall(traced_text)}
    return domains, traced


def read_material_colors(path):
    text = unfold(open(path, encoding="utf-8").read())
    block = text.split("m_Colors:", 1)[1]
    out = {}
    for line in block.split("\n")[1:]:
        m = COLOR_RE.match(line.replace("- ", "  ", 1))
        if not m:
            break
        out[m.group(1)] = tuple(float(v) for v in m.group(2, 3, 4))
    return out


# ── the trace's value id (colour_trace.py value_id / ColorTrace.ValueId in the game repo) ───────────────
def f32(v):
    return struct.unpack("f", struct.pack("f", v))[0]


def byte(v):
    return min(255, max(0, int(math.floor(v * 255.0 + 0.5))))


def value_id(rgb):
    r, g, b = (max(0.0, f32(v)) for v in rgb)
    peak = max(r, g, b)
    hexs = lambda t: "%02X%02X%02X" % tuple(byte(x) for x in t)
    if peak <= 1:
        return "world:" + hexs((r, g, b))
    n = math.floor(peak * 100.0 + 0.5)
    return "world:%sx%d.%02d" % (hexs(tuple(f32(v / peak) for v in (r, g, b))), n // 100, n % 100)


def to_linear(c):
    # the same conversion export_skybox.py uses (Unity's gamma -> linear for a material Color)
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def world_colours(repo):
    """key -> (authored gamma rgb, trace id) for every material colour the screensaver draws."""
    out = {}
    for prefix, (path, props) in MATERIALS.items():
        colours = read_material_colors(os.path.join(repo, path))
        names = props or [k for k in colours if "Direction" not in k and "Normal" not in k]
        for p in names:
            if p not in colours:
                sys.exit(f"export_palette: {path} has no colour {p}")
            out[f"{prefix}.{p}"] = (colours[p], value_id(colours[p]))
    return out


def num(v):
    s = repr(round(v, 7))
    return s[:-2] if s.endswith(".0") else s


def rgb(t):
    return "[" + ", ".join(num(v) for v in t) + "]"


def label(e, default_id):
    name = e["displayName"] or e["id"]
    if e["id"] == default_id:
        return f"{name} (the game's default)"
    if e["vision"] not in ("", "0"):
        return f"{name} (colour vision)"
    return name


def ts_str(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def render_ts(sets, default_id, world_keys, commit):
    out = [
        "// GENERATED by tools/export/export_palette.py. Do not edit; re-run the exporter.",
        f"// Source: the game repo's {CATALOG} and the sets it names, at {commit[:8]}.",
        "",
        "export type RGB = readonly [number, number, number];",
        "",
        "/** A domain's colours: linear HDR values, as the colour set stores them. */",
        "export interface DomainData {",
    ]
    for key, field, note in FIELDS:
        out.append(f"  {key}: RGB;  // {field}" + (f" ({note})" if note else ""))
    out += [
        "}",
        "",
        "export interface ColourSetData {",
        "  /** The game's catalog id (the setting's stored value). */",
        "  id: string;",
        "  /** What the settings show. */",
        "  label: string;",
        "  /** The catalog's line about it. */",
        "  line: string;",
        "  /** Domains in garland.bin's order: Jade, Ruby, Blue, Gold. */",
        "  domains: readonly DomainData[];",
        "  /**",
        "   * The game's colour trace for the materials the screensaver copies, already looked up: material.property ->",
        "   * the colour this set paints there, linear. A key a set leaves out keeps the authored value.",
        "   */",
        "  world: Readonly<Record<string, RGB>>;",
        "}",
        "",
        "/** The set the game paints with by default (ThemeManagerDataContainer's ColorSet). */",
        f"export const DEFAULT_COLOUR_SET = {ts_str(default_id)};",
        "",
        f"export const PALETTE_SOURCE = {{ catalog: {ts_str(CATALOG)}, gameCommit: {ts_str(commit)} }};",
        "",
        "export const COLOUR_SETS: readonly ColourSetData[] = [",
    ]
    for s in sets:
        out += [
            "  {",
            f"    id: {ts_str(s['id'])},",
            f"    label: {ts_str(s['label'])},",
            f"    line: {ts_str(s['line'])},",
            "    domains: [",
        ]
        for d in DOMAINS:
            vals = ", ".join(f"{key}: {rgb(s['domains'][d][field])}" for key, field, _ in FIELDS)
            out.append(f"      {{ {vals} }}, // {d}")
        out.append("    ],")
        if s["world"]:
            out.append("    world: {")
            for k, v in s["world"].items():
                out.append(f"      {ts_str(k)}: {rgb(v)},")
            out.append("    },")
        else:
            out.append("    world: {},")
        out.append("  },")
    out += ["];", ""]
    return "\n".join(out)


def c_str(s):
    return 'L"' + "".join(ch if 32 <= ord(ch) < 127 and ch not in '"\\' else "\\x%04x" % ord(ch) for ch in s) + '"'


def render_h(sets, default_id, commit):
    out = [
        "#pragma once",
        "// GENERATED by tools/export/export_palette.py from the game's colour set catalog",
        f"// at {commit[:8]}. Do not edit; re-run the exporter.",
        "",
        "struct ColourSetEntry {",
        "  const wchar_t* id;     // the stored setting, passed to the page as ?colours=",
        "  const wchar_t* label;  // what the settings dialog shows",
        "};",
        "",
        "constexpr ColourSetEntry kColourSets[] = {",
    ]
    for s in sets:
        out.append(f"    {{{c_str(s['id'])}, {c_str(s['label'])}}},")
    out += ["};", "", f"constexpr const wchar_t* kDefaultColourSet = {c_str(default_id)};", ""]
    return "\n".join(out)


def swift_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_swift(sets, default_id, commit):
    out = [
        "// GENERATED by tools/export/export_palette.py from the game's colour set catalog",
        f"// at {commit[:8]}. Do not edit; re-run the exporter.",
        "",
        "/// The colour sets the Options… sheet lists: the stored id (passed to the page as ?colours=) and its label.",
        "enum ColourSets {",
        "  static let all: [(id: String, label: String)] = [",
    ]
    for s in sets:
        out.append(f"    ({swift_str(s['id'])}, {swift_str(s['label'])}),")
    out += ["  ]", f"  static let defaultId = {swift_str(default_id)}", "}", ""]
    return "\n".join(out)


def build(repo):
    commit = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True,
                            text=True, check=True).stdout.strip()
    catalog = read_catalog(repo)
    live = live_guid(repo)
    default = next((e["id"] for e in catalog if e["guid"] == live), None)
    if default is None:
        sys.exit(f"export_palette: the live colour set (guid {live}) is not in {CATALOG}")
    loaded = {e["id"]: read_set(os.path.join(repo, find_by_guid(repo, e["guid"]))) for e in catalog}
    if AUTHORED_SET not in loaded:
        sys.exit(f"export_palette: no '{AUTHORED_SET}' set in {CATALOG}; the trace needs the authored set")
    authored_trace = loaded[AUTHORED_SET][1]
    world = world_colours(repo)
    # A key is traced when the authored set traces its id and some set paints it differently (to 8 bits).
    traced_keys = []
    for k, (gamma, cid) in world.items():
        if cid not in authored_trace:
            continue
        if any(value_id(t.get(cid, gamma)) != cid for _, t in loaded.values()):
            traced_keys.append(k)
    sets = []
    # the default first, then the catalog's order
    for e in sorted(catalog, key=lambda e: e["id"] != default):
        if e["unlocked"] != "1":
            continue
        domains, trace = loaded[e["id"]]
        w = {}
        for k in traced_keys:
            gamma, cid = world[k]
            w[k] = tuple(to_linear(v) for v in trace.get(cid, gamma))
        sets.append({"id": e["id"], "label": label(e, default), "line": e["line"], "domains": domains, "world": w})
    files = {OUT_TS: render_ts(sets, default, traced_keys, commit), OUT_H: render_h(sets, default, commit)}
    if os.path.isdir(MAC_DIR):
        files[OUT_SWIFT] = render_swift(sets, default, commit)
    return files, sets, default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-repo", required=True)
    ap.add_argument("--check", action="store_true", help="exit 1 if any output would change")
    a = ap.parse_args()
    files, sets, default = build(os.path.abspath(a.game_repo))
    # the commit lines move with every game commit; only the content counts as drift
    strip = lambda s: "\n".join(l for l in s.split("\n") if "gameCommit" not in l and not re.match(
        r"^(// Source:|// at [0-9a-f]{8}\.)", l))
    drift = []
    for path, text in files.items():
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
        if strip(old) != strip(text):
            drift.append(os.path.relpath(path, ROOT))
    if a.check:
        if not drift:
            print(f"palette: in sync with the game's {len(sets)} colour sets (default {default})")
            return 0
        print(f"palette: DRIFT in {', '.join(drift)}. Re-run without --check.")
        return 1
    for path, text in files.items():
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    print(f"palette: wrote {len(sets)} colour sets (default {default}); "
          f"{'changed: ' + ', '.join(drift) if drift else 'no change'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
