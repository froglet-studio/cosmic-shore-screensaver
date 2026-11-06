"""Port the game's HyperSea skybox into src/sky_shader.ts.

    python3 tools/export/export_skybox.py --game-repo ../Cosmic-Shore            # write src/sky_shader.ts
    python3 tools/export/export_skybox.py --game-repo ../Cosmic-Shore --check    # exit 1 if it would change

Reads Assets/_Graphics/Materials/Shaders/HyperSeaSkybox.shader (the CGINCLUDE block: every function the sky
uses) and the material Menu_Main paints with, Assets/_Graphics/Skyboxes/HyperSeaSkybox.mat (its numbers), and
writes the same functions as GLSL ES with the material's values as uniforms. The translation is mechanical
(HLSL types and intrinsics to GLSL), so a change to the game's sky is one re-run. The directions in the shader
stay in Unity's frame; src/sky.ts flips z on the way in. Plain Python 3, no dependencies.
"""
import argparse
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "src", "sky_shader.ts"))
SHADER = "Assets/_Graphics/Materials/Shaders/HyperSeaSkybox.shader"
MATERIAL = "Assets/_Graphics/Skyboxes/HyperSeaSkybox.mat"


def game_commit(repo):
    try:
        return subprocess.check_output(["git", "-C", repo, "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def read_material(path):
    floats, colors = {}, {}
    section = None
    for line in open(path, encoding="utf-8"):
        s = line.strip()
        if s.startswith("m_Floats:"):
            section = "f"
            continue
        if s.startswith("m_Colors:"):
            section = "c"
            continue
        if s.startswith("m_") and not s.startswith("- "):
            section = None
            continue
        m = re.match(r"- (_\w+): (.+)$", s)
        if not m or not section:
            continue
        name, val = m.group(1), m.group(2)
        if section == "f":
            floats[name] = float(val)
        else:
            c = re.match(r"\{r: ([-\d.eE]+), g: ([-\d.eE]+), b: ([-\d.eE]+), a: ([-\d.eE]+)\}", val)
            colors[name] = tuple(float(x) for x in c.groups())
    return floats, colors


def read_shader(path):
    src = open(path, encoding="utf-8").read()
    block = src[src.index("CGINCLUDE") + len("CGINCLUDE"):src.index("ENDCG")]
    # uniform declarations: "half4 _Name;" / "float _Name;"
    decls = re.findall(r"^\s*(half|half4|float|float4)\s+(_\w+)\s*;", block, re.M)
    # the functions: from the first hash function to the end of hyperSeaFrag
    start = block.index("float hash31(")
    body = block[start:]
    body = re.sub(r"//[^\n]*", "", body)
    # drop the struct-free tail after hyperSeaFrag's closing brace
    return decls, body


def to_glsl(body):
    rules = [
        (r"\bhalf4\b", "vec4"), (r"\bhalf3\b", "vec3"), (r"\bhalf2\b", "vec2"), (r"\bhalf\b", "float"),
        (r"\bfloat4\b", "vec4"), (r"\bfloat3\b", "vec3"), (r"\bfloat2\b", "vec2"),
        (r"\bfrac\b", "fract"), (r"\blerp\b", "mix"), (r"\batan2\b", "atan"),
        (r"\b_Time\.y\b", "uTime"),
        (r"return 0;", "return vec3(0.0);"),
        (r"(\bvec3\s+\w+\s*=\s*)0;", r"\g<1>vec3(0.0);"),
        (r"(\bfloat\s+\w+\s*=\s*)0;", r"\g<1>0.0;"),
    ]
    for a, b in rules:
        body = re.sub(a, b, body)
    # the entry point returns the colour only (vec3), alpha is set by the caller
    body = body.replace("vec4 hyperSeaFrag(vec3 viewDir)", "vec3 hyperSeaColor(vec3 viewDir)")
    body = body.replace("return vec4(color, 1.0);", "return color;")
    body = re.sub(r"\n\s*\n+", "\n", body).strip()
    return body


def is_vector(name):
    return "Direction" in name or "Normal" in name


def to_linear(c):
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def js_num(x):
    return repr(round(x, 7))


def build(repo):
    decls, body = read_shader(os.path.join(repo, SHADER))
    floats, colors = read_material(os.path.join(repo, MATERIAL))
    uniforms = []
    values = []
    for typ, name in decls:
        glsl = "float" if typ in ("half", "float") else "vec3"
        uniforms.append(f"uniform {glsl} {name};")
        if glsl == "float":
            v = floats.get(name, 0.0)  # a field the material does not carry is 0 (Unity's default for an unset global)
            values.append(f"  {name}: {js_num(v)},")
        else:
            r, g, b, _ = colors.get(name, (0.0, 0.0, 0.0, 0.0))
            if not is_vector(name):
                # The game renders in linear space (ProjectSettings m_ActiveColorSpace: 1), where Unity converts a
                # material Color from the gamma value it stores; vectors (directions) are passed through as is.
                r, g, b = (to_linear(r), to_linear(g), to_linear(b))
            values.append(f"  {name}: [{js_num(r)}, {js_num(g)}, {js_num(b)}],")
    glsl = to_glsl(body)
    # ".rgb" / ".xyz" of a vec4 uniform become plain vec3 reads
    glsl = re.sub(r"(\b_\w+)\.(rgb|xyz)\b", r"\1", glsl)
    commit = game_commit(repo)
    out = f"""// GENERATED by tools/export/export_skybox.py from the game repo at {commit[:8]}:
//   {SHADER}
//   {MATERIAL}
// Do not edit by hand; re-run the exporter. Colours are linear (the game renders in linear space);\n// directions are in Unity's frame (left-handed).

/** The material's values, one per uniform the shader declares. */
export const SKY_VALUES: Record<string, number | [number, number, number]> = {{
{chr(10).join(values)}
}};

export const SKY_GLSL = /* glsl */ `
uniform float uTime;
{chr(10).join(uniforms)}
#define saturate(x) clamp(x, 0.0, 1.0)
{glsl}
`;
"""
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-repo", required=True)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    text = build(a.game_repo)
    if a.check:
        old = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        strip = lambda s: re.sub(r"^// GENERATED.*\n", "", s)
        if strip(old) != strip(text):
            print("sky_shader.ts is out of date: re-run tools/export/export_skybox.py")
            return 1
        print("sky_shader.ts in sync")
        return 0
    open(OUT, "w", encoding="utf-8").write(text)
    print(f"wrote {os.path.relpath(OUT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
