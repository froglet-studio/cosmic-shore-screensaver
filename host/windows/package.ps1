# Zips dist-windows/CosmicShore.scr with README.txt and writes SHA256SUMS.txt. Runs after the .scr is
# built (build.ps1) and, in a release, after it is signed, so the zip and the sums hold the signed file.
#   pwsh host/windows/package.ps1 -Version 0.1.0
# Writes:  dist-windows/CosmicShoreScreensaver-<version>-windows.zip   (CosmicShore.scr + README.txt)
#          dist-windows/SHA256SUMS.txt
param([string]$Version = "0.0.0")
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot/../.."
$out = Join-Path $root "dist-windows"
$scr = Join-Path $out "CosmicShore.scr"
if (-not (Test-Path $scr)) { throw "missing $scr (run build.ps1 first)" }

$sig = Get-AuthenticodeSignature $scr
if ($sig.Status -eq "Valid") { Write-Host "signed by: $($sig.SignerCertificate.Subject)" }
else { Write-Host "unsigned build ($($sig.Status)): SmartScreen will show 'Windows protected your PC'" }

$zip = Join-Path $out "CosmicShoreScreensaver-$Version-windows.zip"
$stage = Join-Path $root "build/zip"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item $scr $stage
(Get-Content "$PSScriptRoot/README.txt" -Raw).Replace("{{VERSION}}", $Version) | Set-Content "$stage/README.txt" -Encoding utf8 -NoNewline
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage/*" -DestinationPath $zip -CompressionLevel Optimal

$sums = foreach ($f in @($zip, $scr)) { "{0}  {1}" -f (Get-FileHash $f -Algorithm SHA256).Hash.ToLower(), (Split-Path $f -Leaf) }
$sums | Set-Content (Join-Path $out "SHA256SUMS.txt") -Encoding ascii
"{0,-48} {1,8:N2} MB" -f (Split-Path $zip -Leaf), ((Get-Item $zip).Length / 1MB)
