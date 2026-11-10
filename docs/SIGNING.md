# Signing the Windows screensaver (M6)

Today `CosmicShore.scr` is unsigned, so Windows says **"Windows protected your PC"** and **"Unknown
publisher"**. Signing puts **Froglet Games, Inc.** on it as the publisher, proves the file has not been
changed since we built it, and lets Windows start trusting our releases.

## What signing does and does not fix

- A signed file shows our name instead of "Unknown publisher", and antivirus programs are much less
  suspicious of it.
- **The SmartScreen warning does not vanish on day one.** Microsoft says plainly that Artifact Signing
  "does not provide instant SmartScreen trust": Windows learns to trust a publisher as its signed files
  are downloaded without trouble. Every release signed under the same identity adds to that. No
  certificate skips this any more: the EV certificates that used to skip it lost that in 2024.
- So: sign every release from now on, under the one identity, and the warning fades as downloads grow.

## The choice: Azure Artifact Signing

Checked against Microsoft's pages on 2026-11-10.

| Option | Cost | Fits us? |
|---|---|---|
| **Azure Artifact Signing** (was "Trusted Signing") | **about $9.99/month** (Basic: 5,000 signatures a month, we use a few) | **Yes.** US organisations qualify. No key to guard: Microsoft holds it and renews the short-lived certificates. Signs straight from GitHub Actions. |
| An OV certificate from a certificate seller | $150-300/year, plus a hardware token or a paid cloud key service (required since 2023) | Works, costs more, and the key needs looking after. Same SmartScreen behaviour as Artifact Signing. |
| An EV certificate | more again | No longer skips SmartScreen (since 2024), so no gain. |
| SignPath Foundation (free for open source) | free | Needs the whole project under an open-source licence and their review. Our vessel and fish models' licence is still open (plan D7), so not now. |
| Self-signed | free | Blocks installs for the public. Testing only. |

**Recommendation: Azure Artifact Signing**, on a Basic account for Froglet Games, Inc. It is the cheapest
credible option and the only one with nothing secret to keep safe.

Who qualifies: organisations in the US, Canada, the EU, the UK, Australia, New Zealand, Japan, South Korea,
Singapore, Switzerland, Norway and Israel; individuals only in the US and Canada. Microsoft checks the
company's identity, which takes **1 to 20 business days**. Billing starts the day the account is made (not
pro rata), so start the account when you are ready to start the check.

Sources: [pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/),
[quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart),
[roles](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-resources-roles),
[Windows code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options),
[the signing action](https://github.com/Azure/artifact-signing-action).

## Setting it up (Caleb, in the browser; about 30 minutes plus the wait)

Everything is clicks in the Azure portal and GitHub. Nothing is a password we have to store: GitHub proves
who it is to Azure each time it signs. The names in `code font` are suggestions; if you pick others, use
the same ones in step 9.

**A. Azure account and billing**

1. Go to https://portal.azure.com and sign in with your Froglet work account. If Froglet has no Azure
   subscription yet, the portal offers to make one: choose **Pay-As-You-Go** and add the company card.
   (If someone else at Froglet already runs Azure, ask them to add you to that subscription instead.)
2. Open **Subscriptions** > your subscription > **Resource providers**, search **Microsoft.CodeSigning**,
   select it and click **Register**. Wait until it says Registered.

**B. The signing account and the identity check**

3. In the top search box type **Artifact Signing** and open **Artifact Signing Accounts** > **Create**.
   - Resource group: **Create new** > `cosmic-shore-signing`
   - Account name: `froglet-signing` (letters and numbers, must be unique in the world)
   - Region: **East US**
   - Pricing tier: **Basic**
   Click **Review + create** > **Create**. (Billing starts here: about $9.99 a month.)
4. Open the new account > **Access control (IAM)** > **Add** > **Add role assignment**. Pick the role
   **Artifact Signing Identity Verifier**, then **Members** > **Select members** > yourself > **Review +
   assign**. This lets you send the identity check.
5. In the account, open **Identity validations** > **New identity** > **Public** > **Organization**. Fill
   in Froglet Games, Inc.'s **exact legal name and address** as registered, the website
   (`https://www.froglet.games`), a work email on the company's domain, and the company's tax ID (EIN).
   Submit. Microsoft emails that address if it needs documents. Wait for the status **Completed** (1 to 20
   business days). The legal name here is what Windows will show as the publisher.
6. When it is Completed: **Certificate profiles** > **Create** > **Public Trust**. Name: `cosmic-shore`.
   Pick the identity validation from step 5. Create.

**C. Let the release workflow sign**

7. In the portal search, open **Microsoft Entra ID** > **App registrations** > **New registration**.
   Name: `cosmic-shore-screensaver-release`. Leave the rest. **Register**. On its page, copy the
   **Application (client) ID** and the **Directory (tenant) ID** somewhere for step 9.
8. Still on that app: **Certificates & secrets** > **Federated credentials** > **Add credential**.
   Scenario: **GitHub Actions deploying Azure resources**. Organization `froglet-studio`, Repository
   `cosmic-shore-screensaver`, Entity type **Environment**, Environment name `release`. Name it
   `github-release`. **Add**.
9. Back on the signing account from step 3 > **Access control (IAM)** > **Add role assignment** > role
   **Artifact Signing Certificate Profile Signer** > **Members** > **Select members** > search
   `cosmic-shore-screensaver-release` > **Review + assign**.
10. On GitHub, open https://github.com/froglet-studio/cosmic-shore-screensaver/settings/environments >
    **release** > under **Environment variables** click **Add environment variable** five times:

    | Name | Value |
    |---|---|
    | `AZURE_CLIENT_ID` | the Application (client) ID from step 7 |
    | `AZURE_TENANT_ID` | the Directory (tenant) ID from step 7 |
    | `SIGNING_ENDPOINT` | `https://eus.codesigning.azure.net/` (East US; another region has its own) |
    | `SIGNING_ACCOUNT` | `froglet-signing` |
    | `SIGNING_PROFILE` | `cosmic-shore` |

    These are not secrets (they are names, not keys), which is why they go under variables.
11. Publish the next release as before (Actions > Release > Run workflow, with the next version). Tell the
    Claude thread, which reads the run and checks the signature. The run now says who signed it.

## What happens in the release workflow

`.github/workflows/release.yml`:

1. builds `CosmicShore.scr` (`host/windows/build.ps1 -NoPackage`);
2. if `SIGNING_ACCOUNT` is set: signs in to Azure with GitHub's OIDC token, signs the `.scr` with
   SHA-256 and Microsoft's timestamp (`azure/artifact-signing-action@v2`), and checks that the signature is
   valid and timestamped. Any failure stops the release; it never quietly publishes an unsigned file once
   signing is set up;
3. if it is not set: a warning in the run says the build is unsigned, and the release notes say so;
4. zips the (signed) `.scr` with `README.txt` and writes `SHA256SUMS.txt` (`host/windows/package.ps1`);
5. runs the smoke test on the same file and publishes the GitHub Release.

The timestamp matters: Artifact Signing's certificates last only a few days, and the timestamp is what
keeps the signature valid after that.

## After the first signed release

- Change the landing page's `/screensaver` install text: the publisher now reads Froglet Games, Inc., and
  the warning may still appear for a while. If the validated legal name is not exactly "Froglet Games,
  Inc.", fix the wording in `release.yml` and `host/windows/README.txt` too.
- Keep signing every release under the same account and certificate profile; switching identity resets
  the trust Windows has built.
- macOS signing is separate (plan §8.2, M7b) and goes through Shombith's Apple Developer team.
