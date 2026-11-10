#!/usr/bin/env bash
# Signs CosmicShore.saver as well as the configured secrets allow, and says plainly what it did
# (plan §8.2, milestone M7b). Shombith's setup steps are in host/macos/SIGNING.md.
#   host/macos/sign.sh <path/to/CosmicShore.saver> <file to write the result to>
# The result is one word: adhoc, developer-id or notarized.
#
# Nothing set:                      ad-hoc signed (codesign -s -). Apple silicon needs at least that to
#                                   load it; Gatekeeper still blocks the download until the user allows it.
# MACOS_CERT_P12_BASE64             the "Developer ID Application" certificate and its private key, as a
# MACOS_CERT_PASSWORD               base64 .p12 and the .p12's password: signed with the hardened runtime.
# and one way to reach the notary service, to notarize and staple:
#   NOTARY_KEY_P8_BASE64, NOTARY_KEY_ID, NOTARY_ISSUER_ID   an App Store Connect API key (preferred)
#   APPLE_ID, APPLE_APP_PASSWORD, APPLE_TEAM_ID             or an Apple ID with an app-specific password
set -euo pipefail
saver="$1"
result="$2"
tmp="${RUNNER_TEMP:-$(mktemp -d)}/cosmicshore-signing"
rm -rf "$tmp"
mkdir -p "$tmp"

if [[ -z "${MACOS_CERT_P12_BASE64:-}" || -z "${MACOS_CERT_PASSWORD:-}" ]]; then
  codesign --force --sign - --timestamp=none "$saver"
  codesign --verify --strict --verbose=2 "$saver"
  echo "ad-hoc signed: Developer ID signing is not configured (host/macos/SIGNING.md)"
  echo adhoc > "$result"
  exit 0
fi

# ── Developer ID: a throwaway keychain that only this job can see ─────────────────────────────────
keychain="$tmp/signing.keychain-db"
kc_pass="$(uuidgen)"
cleanup() { security delete-keychain "$keychain" 2>/dev/null || true; rm -rf "$tmp"; }
trap cleanup EXIT
echo "$MACOS_CERT_P12_BASE64" | base64 --decode > "$tmp/cert.p12"
security create-keychain -p "$kc_pass" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$kc_pass" "$keychain"
security import "$tmp/cert.p12" -k "$keychain" -P "$MACOS_CERT_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$kc_pass" "$keychain" > /dev/null
# keep the login keychain in the search list, add ours in front
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
identity="$(security find-identity -v -p codesigning "$keychain" | awk '/Developer ID Application/ { print $2; exit }')"
[[ -n "$identity" ]] || { echo "no 'Developer ID Application' identity in MACOS_CERT_P12_BASE64" >&2; exit 1; }
security find-identity -v -p codesigning "$keychain" | grep "$identity"

codesign --force --options runtime --timestamp --sign "$identity" --keychain "$keychain" "$saver"
codesign --verify --strict --verbose=2 "$saver"
codesign -dv --verbose=2 "$saver" 2>&1 | grep -E "Authority|TeamIdentifier|Runtime" || true

# ── notarization ─────────────────────────────────────────────────────────────────────────────────
auth=()
if [[ -n "${NOTARY_KEY_P8_BASE64:-}" && -n "${NOTARY_KEY_ID:-}" && -n "${NOTARY_ISSUER_ID:-}" ]]; then
  echo "$NOTARY_KEY_P8_BASE64" | base64 --decode > "$tmp/AuthKey_$NOTARY_KEY_ID.p8"
  auth=(--key "$tmp/AuthKey_$NOTARY_KEY_ID.p8" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER_ID")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  auth=(--apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  echo "Developer ID signed, NOT notarized: no notary credentials (host/macos/SIGNING.md)"
  echo developer-id > "$result"
  exit 0
fi

ditto -c -k --keepParent "$saver" "$tmp/notarize.zip"
if ! xcrun notarytool submit "$tmp/notarize.zip" "${auth[@]}" --wait --timeout 30m --output-format json > "$tmp/notary.json"; then
  cat "$tmp/notary.json" >&2 || true
fi
cat "$tmp/notary.json"
status="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$tmp/notary.json")"
if [[ "$status" != "Accepted" ]]; then
  sub="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "$tmp/notary.json")"
  [[ -n "$sub" ]] && xcrun notarytool log "$sub" "${auth[@]}" || true
  echo "notarization was not accepted (status: ${status:-none})" >&2
  exit 1
fi
xcrun stapler staple "$saver"
xcrun stapler validate "$saver"
echo "Developer ID signed, notarized and stapled"
echo notarized > "$result"
