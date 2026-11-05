"""Parity check: what changed in the game's Home screen since the screensaver last copied it.

    python3 tools/parity/check.py --game-repo ../Cosmic-Shore                 # report, exit 1 on drift
    python3 tools/parity/check.py --game-repo ../Cosmic-Shore --out smoke-out/parity-report.md
    python3 tools/parity/check.py --game-repo ../Cosmic-Shore --mark-synced palette,camera

Reads parity/sources.json. For every item the screensaver has built, it lists the game commits that
touched that item's game paths since the item's synced_at commit, and flags game paths that no longer
exist (a rename or a move breaks an exporter silently). Two items are checked by value, not by history:
the palette (tools/export/export_palette.py --check), the sky (tools/export/export_skybox.py --check) and the
Garland generator (its source hash).

--mark-synced moves those items' synced_at to the game repo's HEAD. Run it only after the screensaver
matches the game for those items. Plain Python 3, no dependencies; it only reads the game repo.
See parity/PARITY.md for the procedure.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SOURCES = os.path.join(ROOT, "parity", "sources.json")
MAX_COMMITS = 12


def git(repo, *args):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def path_exists(repo, rev, path):
    if path.endswith("/"):
        return bool(git(repo, "ls-tree", "-d", rev, path.rstrip("/")))
    return git(repo, "cat-file", "-e", f"{rev}:{path}") is not None


def auto_palette(repo):
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "export", "export_palette.py"),
                        "--game-repo", repo, "--check"], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def auto_garland(repo):
    meta = json.load(open(os.path.join(ROOT, "public", "content", "garland.json"), encoding="utf-8"))
    src = meta["source"]["generator"]
    p = os.path.join(repo, src)
    if not os.path.exists(p):
        return False, f"garland: generator {src} is gone from the game repo"
    now = hashlib.sha256(open(p, "rb").read()).hexdigest()
    if now == meta["source"]["generator_sha256"]:
        return True, "garland: generator unchanged since the export"
    return False, "garland: SpawnableGarland.cs changed since the export; re-run tools/export/export_garland.py"


def auto_skybox(repo):
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "export", "export_skybox.py"),
                        "--game-repo", repo, "--check"], capture_output=True, text=True)
    return r.returncode == 0, "skybox: " + (r.stdout.strip() or r.stderr.strip())


AUTO = {"palette": auto_palette, "garland": auto_garland, "skybox": auto_skybox}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-repo", required=True)
    ap.add_argument("--rev", default="HEAD", help="game revision to compare against (default HEAD)")
    ap.add_argument("--out", help="also write the report to this file")
    ap.add_argument("--mark-synced", help="comma-separated item ids to move to --rev")
    a = ap.parse_args()
    repo = os.path.abspath(a.game_repo)
    src = json.load(open(SOURCES, encoding="utf-8"))
    head = git(repo, "rev-parse", a.rev)
    if not head:
        sys.exit(f"parity: {repo} is not a git checkout of the game repo")
    when = git(repo, "log", "-1", "--format=%ci", head)

    if a.mark_synced:
        ids = {i.strip() for i in a.mark_synced.split(",") if i.strip()}
        known = {it["id"] for it in src["items"]}
        if ids - known:
            sys.exit(f"parity: unknown ids {sorted(ids - known)}")
        for it in src["items"]:
            if it["id"] in ids:
                it["synced_at"] = head
        with open(SOURCES, "w", encoding="utf-8", newline="\n") as f:
            json.dump(src, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"parity: {', '.join(sorted(ids))} marked synced at {head[:8]} ({when})")
        return 0

    out = [f"# Parity report", "",
           f"Game repo at `{head[:8]}` ({when}). Branch to compare against: `{src['game_branch']}`.", ""]
    behind = git(repo, "rev-list", "--count", f"{head}..origin/{src['game_branch']}")
    if behind and behind != "0":
        out += [f"> **The game checkout is {behind} commits behind origin/{src['game_branch']}.** "
                f"Run `git -C {a.game_repo} pull` first, or this report is stale.", ""]

    attention, quiet, planned = [], [], []
    for it in src["items"]:
        if not it.get("synced_at"):
            planned.append(it)
            continue
        lines = []
        missing = [p for p in it["game"] if not path_exists(repo, head, p)]
        for p in missing:
            lines.append(f"- **Missing in the game repo:** `{p}` (renamed or moved? fix parity/sources.json and the exporter)")
        present = [p for p in it["game"] if p not in missing]
        log = git(repo, "log", "--no-merges", "--format=%h %cs %an: %s", f"{it['synced_at']}..{head}",
                  "--", *present) if present else ""
        if log is None:
            lines.append(f"- synced_at `{it['synced_at'][:8]}` is not in this checkout; fetch the game repo")
            log = ""
        commits = [c for c in log.split("\n") if c]
        if it["id"] in AUTO:
            ok, msg = AUTO[it["id"]](repo)
            lines.insert(0, f"- {'In sync' if ok else '**Out of sync**'} by value: {msg}")
            if ok and not missing:
                if commits:
                    lines.append(f"- {len(commits)} game commit(s) touched these files without changing what the screensaver uses.")
                quiet.append((it, lines))
                continue
        if commits:
            files = git(repo, "diff", "--name-status", "-M", f"{it['synced_at']}..{head}", "--", *present)
            lines.append(f"- {len(commits)} game commit(s) since `{it['synced_at'][:8]}`:")
            lines += [f"  - {c}" for c in commits[:MAX_COMMITS]]
            if len(commits) > MAX_COMMITS:
                lines.append(f"  - ... and {len(commits) - MAX_COMMITS} more")
            lines.append("- Files changed: " + ", ".join(f"`{f}`" for f in files.split("\n") if f)[:2000])
        if lines and (commits or missing or (it["id"] in AUTO)):
            attention.append((it, lines))
        else:
            quiet.append((it, ["- No game change since the last sync."]))

    out += [f"## Needs attention ({len(attention)})", ""]
    if not attention:
        out += ["Nothing. The screensaver matches every Home screen piece it has built.", ""]
    for it, lines in attention:
        out += [f"### {it['id']}: {it['what']}", "",
                f"Screensaver files: {', '.join('`' + s + '`' for s in it['screensaver']) or 'none yet'}. "
                f"How to sync: {it['sync']}", ""] + lines + [""]
    out += [f"## In sync ({len(quiet)})", ""]
    for it, lines in quiet:
        out += [f"- **{it['id']}** (synced at `{it['synced_at'][:8]}`)"] + ["  " + l for l in lines if l]
    out += ["", f"## Not built yet ({len(planned)})", "",
            "Export these from the game's HEAD when they are built, then `--mark-synced` them.", ""]
    out += [f"- **{it['id']}**: {it['what']}" for it in planned]
    text = "\n".join(out) + "\n"
    print(text)
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    return 1 if attention else 0


if __name__ == "__main__":
    sys.exit(main())
