# Prints the smoke screenshots into the job log as small base64 JPEGs between markers, so a reviewer
# who cannot download artifacts (a remote session behind a proxy) can still look at them.
param([string]$Dir = "smoke-windows", [int]$Width = 640)
Add-Type -AssemblyName System.Drawing
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq "image/jpeg"
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 70L
foreach ($f in Get-ChildItem $Dir -Filter *.png) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $h = [int]($img.Height * $Width / $img.Width)
  $bmp = New-Object System.Drawing.Bitmap $img, $Width, $h
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, $codec, $ep)
  Write-Host "=====BEGIN $($f.BaseName)====="
  $b64 = [Convert]::ToBase64String($ms.ToArray())
  for ($i = 0; $i -lt $b64.Length; $i += 4000) { Write-Host $b64.Substring($i, [Math]::Min(4000, $b64.Length - $i)) }
  Write-Host "=====END $($f.BaseName)====="
  $img.Dispose(); $bmp.Dispose(); $ms.Dispose()
}
