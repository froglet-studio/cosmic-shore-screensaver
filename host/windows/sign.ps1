# Signs a file when signing is configured, and says plainly when it is not (plan §8.1, milestone M6).
# Until then every build is unsigned and SmartScreen shows "Windows protected your PC" on first run.
#
# To turn signing on later (Azure Artifact Signing), add these to the repo's protected "release"
# environment and nothing else changes:
#   SIGNING_ENDPOINT   e.g. https://eus.codesigning.azure.net
#   SIGNING_ACCOUNT    the Artifact Signing account name
#   SIGNING_PROFILE    the certificate profile name
#   SIGNING_DLIB       path to Azure.CodeSigning.Dlib.dll (installed by the workflow step that signs in)
param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = "Stop"
if (-not $env:SIGNING_ENDPOINT -or -not $env:SIGNING_ACCOUNT -or -not $env:SIGNING_PROFILE -or -not $env:SIGNING_DLIB) {
  Write-Host "unsigned build: signing is not configured (host/windows/sign.ps1)"
  return
}
$meta = Join-Path $env:RUNNER_TEMP "signing-metadata.json"
@{ Endpoint = $env:SIGNING_ENDPOINT; CodeSigningAccountName = $env:SIGNING_ACCOUNT; CertificateProfileName = $env:SIGNING_PROFILE } |
  ConvertTo-Json | Set-Content $meta
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName | Select-Object -Last 1
& $signtool.FullName sign /v /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib $env:SIGNING_DLIB /dmdf $meta $Path
if ($LASTEXITCODE) { throw "signing failed" }
Write-Host "signed $Path"
