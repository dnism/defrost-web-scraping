# LexiScrape Packaging Script per Firefox (.xpi / .zip)
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $RootDir "dist"
if (-not (Test-Path $DistDir)) {
  New-Item -ItemType Directory -Path $DistDir | Out-Null
}

$ZipPath = Join-Path $DistDir "defrost-firefox.zip"
$XpiPath = Join-Path $DistDir "defrost-firefox.xpi"

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
if (Test-Path $XpiPath) { Remove-Item $XpiPath -Force }

$ItemsToInclude = @(
  "manifest.json",
  "icons",
  "shared",
  "content",
  "background",
  "sidebar",
  "popup"
) | ForEach-Object { Join-Path $RootDir $_ }

Compress-Archive -Path $ItemsToInclude -DestinationPath $ZipPath -Force
Copy-Item -Path $ZipPath -Destination $XpiPath -Force

# Crea anche alias per retrocompatibilità
Copy-Item -Path $XpiPath -Destination (Join-Path $DistDir "lexiscrape-firefox.xpi") -Force
Copy-Item -Path $ZipPath -Destination (Join-Path $DistDir "lexiscrape-firefox.zip") -Force

Write-Host "Pacchetto Firefox generato con successo:" -ForegroundColor Green
Write-Host " - $XpiPath"
Write-Host " - $ZipPath"
