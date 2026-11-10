# Builds CosmicShore.scr and its download zip on Windows (MSVC). CI runs exactly this.
#   pwsh host/windows/build.ps1 -Version 0.1.0
# The release workflow runs it with -NoPackage, signs the .scr (Azure Artifact Signing, when configured),
# then zips with host/windows/package.ps1, so the zip always holds the signed file.
# Needs: Node 22 (for the web page), CMake and Visual Studio 2022 Build Tools (C++ workload).
# Writes:  dist-windows/CosmicShore.scr
#          dist-windows/CosmicShoreScreensaver-<version>-windows.zip   (CosmicShore.scr + README.txt)
#          dist-windows/SHA256SUMS.txt
param(
  [string]$Version = "0.0.0",
  [switch]$SkipWeb,    # reuse dist-single/screensaver-host.html as it is
  [switch]$NoPackage   # stop after dist-windows/CosmicShore.scr (sign it, then run package.ps1)
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot/../.."
Push-Location $root
try {
  # 1. The page, as one self-contained HTML file.
  if (-not $SkipWeb) { npm run build:host; if ($LASTEXITCODE) { throw "npm run build:host failed" } }
  $html = Join-Path $root "dist-single/screensaver-host.html"
  if (-not (Test-Path $html)) { throw "missing $html" }

  # 2. The WebView2 SDK (headers + static loader), pinned, from nuget.org. Build-time only: nothing
  #    from it ships except the static loader linked into the .scr.
  $wv2Version = "1.0.4314.35"
  $wv2 = Join-Path $root "build/webview2-$wv2Version"
  if (-not (Test-Path "$wv2/build/native/include/WebView2.h")) {
    New-Item -ItemType Directory -Force $wv2 | Out-Null
    $pkg = Join-Path $root "build/webview2-$wv2Version.zip"
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$wv2Version/microsoft.web.webview2.$wv2Version.nupkg" -OutFile $pkg
    Expand-Archive $pkg -DestinationPath $wv2 -Force
  }

  # 3. The host.
  $build = Join-Path $root "build/scr"
  cmake -S host/windows -B $build -A x64 "-DINDEX_HTML=$html" "-DWEBVIEW2_DIR=$wv2" "-DSCR_VERSION=$Version"
  if ($LASTEXITCODE) { throw "cmake configure failed" }
  cmake --build $build --config Release
  if ($LASTEXITCODE) { throw "cmake build failed" }

  $out = Join-Path $root "dist-windows"
  New-Item -ItemType Directory -Force $out | Out-Null
  $scr = Join-Path $out "CosmicShore.scr"
  Copy-Item "$build/Release/CosmicShore.scr" $scr -Force

  "{0,-48} {1,8:N2} MB" -f (Split-Path $scr -Leaf), ((Get-Item $scr).Length / 1MB)

  # 4. Never a bare .scr: browsers and mail flag them (package.ps1 zips it with the install steps).
  if (-not $NoPackage) { & "$PSScriptRoot/package.ps1" -Version $Version }
} finally { Pop-Location }
