#!/usr/bin/env bash
# Prints the smoke pictures into the job log as base64 JPEGs between =====BEGIN name===== markers, so a
# session that cannot download Actions artifacts can still see them (host/windows/print_shots.ps1 twin).
out="${1:-smoke-macos}"
for f in "$out"/*.png; do
  [[ -f "$f" ]] || continue
  name="$(basename "$f" .png)"
  sips -s format jpeg -s formatOptions 60 -Z 960 "$f" --out "/tmp/$name.jpg" > /dev/null 2>&1 || continue
  echo "=====BEGIN $name====="
  base64 -i "/tmp/$name.jpg" | fold -w 76
  echo "=====END $name====="
done
