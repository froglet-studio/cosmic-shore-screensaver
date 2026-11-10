# Signing and notarizing the macOS screensaver (for Shombith)

The release workflow already signs and notarizes `CosmicShore.saver` **as soon as the secrets below exist**.
Nothing in the code changes. Until they exist, every build is ad-hoc signed (it loads on Apple silicon,
and macOS asks the user to allow it once, see `README.txt`), and the release notes say so.

You need: the Froglet Games Apple Developer team (Account Holder or Admin role for step 1), a Mac with
Keychain Access, and admin rights on `froglet-studio/cosmic-shore-screensaver` (for step 3).

## 1. A "Developer ID Application" certificate, exported as a .p12

Skip to the export if the team already has one (Keychain Access shows
`Developer ID Application: Froglet Games, Inc. (TEAMID)` with a private key under it).

1. On the Mac: **Keychain Access > Certificate Assistant > Request a Certificate From a Certificate
   Authority…** Enter your email, choose **Saved to disk**, save the `.certSigningRequest`.
2. At <https://developer.apple.com/account/resources/certificates/add>, choose **Developer ID Application**
   (pick the **G2 Sub-CA** profile if asked), upload the request, download the `.cer` and double-click it.
3. In Keychain Access > **My Certificates**, right-click the new certificate (expand it: the private key
   must be under it) > **Export…** > format **Personal Information Exchange (.p12)**. Set a strong
   password. This file and password are the signing identity: keep them out of chat, email and the repo.
4. Turn it into one line of text for GitHub:
   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```

Apple allows only a few Developer ID certificates per team; if one exists for another product, reuse it.

## 2. A way to reach Apple's notary service

**Preferred: an App Store Connect API key** (it is not tied to a person's password or 2FA).

1. <https://appstoreconnect.apple.com/access/integrations/api> > **Team Keys** > **+**.
   Name `cosmic-shore-screensaver CI`, access **Developer**.
2. Download the `AuthKey_XXXXXXXXXX.p8` (Apple lets you download it once). Note the **Key ID** and the
   **Issuer ID** shown above the list.
3. `base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy`

**Or: an Apple ID with an app-specific password** (<https://account.apple.com> > Sign-In and Security >
App-Specific Passwords), plus the team ID (10 characters, on <https://developer.apple.com/account> >
Membership details).

## 3. Put them into the repo's `release` environment

GitHub > `froglet-studio/cosmic-shore-screensaver` > **Settings > Environments > release** (it exists; the
Windows job uses it) > **Environment secrets > Add secret**:

| Secret | Value |
|---|---|
| `MACOS_CERT_P12_BASE64` | the base64 of the `.p12` (step 1.4) |
| `MACOS_CERT_PASSWORD` | the `.p12`'s password |
| `NOTARY_KEY_P8_BASE64` | the base64 of the `.p8` (step 2) |
| `NOTARY_KEY_ID` | the API key's Key ID |
| `NOTARY_ISSUER_ID` | the Issuer ID |

Or, instead of the three `NOTARY_*`: `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID`.

Environment secrets reach only the `release.yml` jobs, never a pull request's CI. Under **Deployment
branches and tags** you can limit `release` to tags `v*` and the branch `main`.

## 4. Check it

Run **Actions > Release > Run workflow** with a new version (e.g. `0.2.0`). In the `macos` job's
"Build, sign and notarize" step you should see, in order:

- `Developer ID Application: Froglet Games, Inc. (TEAMID)` (the identity it found),
- notarytool's JSON with `"status": "Accepted"` (usually 1-10 minutes),
- `The staple and validate action worked!` and `Developer ID signed, notarized and stapled`.

The release notes then say "Signed by Froglet Games and notarized by Apple", and `README.txt` in the zip
drops the "Open Anyway" steps. If notarization is rejected, the step prints Apple's log (it names each
problem file) and the release is not published.

What each outcome means: `ad-hoc signed` = no certificate secrets; `Developer ID signed, NOT notarized`
= the certificate is there but no notary credentials (Gatekeeper still blocks it, so add them);
`notarized` = done.

## If you would rather sign by hand

Download the macOS zip from a release (it is ad-hoc signed), then on a Mac with the certificate:

```bash
codesign --force --options runtime --timestamp --sign "Developer ID Application: Froglet Games, Inc." CosmicShore.saver
ditto -c -k --keepParent CosmicShore.saver notarize.zip
xcrun notarytool submit notarize.zip --keychain-profile <your profile> --wait
xcrun stapler staple CosmicShore.saver
```

Then zip it again with `README.txt` and replace the release asset. The workflow above does exactly this,
so it is only worth doing once, to try it.
