#!/usr/bin/env bash
# Builds CosmicShore.saver and its download zip on macOS. CI runs exactly this.
#   host/macos/build.sh 0.1.0
# Needs: Node 22 (for the web page) and the Xcode command line tools (swiftc, lipo, codesign, ditto).
# Writes:  dist-macos/CosmicShore.saver                       (universal: Apple silicon + Intel)
#          dist-macos/CosmicShoreScreensaver-<version>-macos.zip   (CosmicShore.saver + README.txt)
#          dist-macos/SHA256SUMS.txt
#          dist-macos/SIGNING                                 (adhoc | developer-id | notarized)
# Set SKIP_WEB=1 to reuse dist-single/screensaver-host.html as it is.
# Signing is host/macos/sign.sh: ad-hoc until the Developer ID secrets exist (host/macos/SIGNING.md).
set -euo pipefail
VERSION="${1:-0.0.0}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$root"

# 1. The page, as one self-contained HTML file (the same one the Windows .scr embeds).
[[ -n "${SKIP_WEB:-}" ]] || npm run build:host
html="$root/dist-single/screensaver-host.html"
[[ -f "$html" ]] || { echo "missing $html" >&2; exit 1; }

# 2. The plug-in, for both architectures, joined into one universal binary.
build="$root/build/saver"
rm -rf "$build"
mkdir -p "$build"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
for arch in arm64 x86_64; do
  xcrun swiftc -O -swift-version 5 -parse-as-library -module-name CosmicShoreSaver \
    -target "$arch-apple-macos12.0" -sdk "$sdk" \
    -framework ScreenSaver -framework WebKit -framework AppKit \
    -Xlinker -bundle -o "$build/CosmicShore-$arch" \
    "$here"/Sources/*.swift
done
saver="$build/CosmicShore.saver"
mkdir -p "$saver/Contents/MacOS" "$saver/Contents/Resources"
lipo -create -output "$saver/Contents/MacOS/CosmicShore" "$build/CosmicShore-arm64" "$build/CosmicShore-x86_64"
file "$saver/Contents/MacOS/CosmicShore"

# 3. The bundle: Info.plist, the page, the thumbnails System Settings shows.
sed "s/{{VERSION}}/$VERSION/g" "$here/Info.plist" > "$saver/Contents/Info.plist"
plutil -lint "$saver/Contents/Info.plist"
cp "$html" "$saver/Contents/Resources/screensaver-host.html"
cp "$here"/Resources/thumbnail*.png "$saver/Contents/Resources/"

# 4. Sign: ad-hoc (enough to load on Apple silicon), or Developer ID + notarization when configured.
"$here/sign.sh" "$saver" "$build/SIGNING"
signing="$(cat "$build/SIGNING")"

# 5. The zip: the .saver and the install steps for how it was signed. ditto keeps the bundle intact.
out="$root/dist-macos"
rm -rf "$out"
mkdir -p "$out"
stage="$build/zip"
mkdir -p "$stage"
ditto "$saver" "$stage/CosmicShore.saver"
python3 - "$here/README.txt" "$stage/README.txt" "$VERSION" "$signing" <<'PY'
import re, sys
src, dst, version, signing = sys.argv[1:]
text = open(src, encoding="utf-8").read().replace("{{VERSION}}", version)
keep = "SIGNED" if signing == "notarized" else "UNSIGNED"
drop = "UNSIGNED" if keep == "SIGNED" else "SIGNED"
text = re.sub(r"\{\{%s\}\}.*?\{\{/%s\}\}\n" % (drop, drop), "", text, flags=re.S)
text = text.replace("{{%s}}\n" % keep, "").replace("{{/%s}}\n" % keep, "")
open(dst, "w", encoding="utf-8").write(text)
PY
zip="$out/CosmicShoreScreensaver-$VERSION-macos.zip"
(cd "$stage" && ditto -c -k --sequesterRsrc . "$zip")
ditto "$saver" "$out/CosmicShore.saver"
cp "$build/SIGNING" "$out/SIGNING"

(cd "$out" && shasum -a 256 "$(basename "$zip")" > SHA256SUMS.txt)
cat "$out/SHA256SUMS.txt"
du -sh "$out/CosmicShore.saver" "$zip"
echo "signing: $signing"
