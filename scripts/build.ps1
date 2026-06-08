$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$distRoot = Join-Path $repoRoot 'dist'
$packageRoot = Join-Path $distRoot 'URL Redirector'
$zipPath = Join-Path $distRoot 'URL Redirector.zip'

if (Test-Path $distRoot) {
    Remove-Item -LiteralPath $distRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $packageRoot | Out-Null

$itemsToCopy = @(
    'manifest.json',
    'background',
    'icons',
    'options',
    'popup'
)

foreach ($item in $itemsToCopy) {
    $source = Join-Path $repoRoot $item
    $destination = Join-Path $packageRoot $item

    if (-not (Test-Path $source)) {
        throw "Missing required extension file or directory: $item"
    }

    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

$readme = @'
URL Interceptor & Redirector - Chrome Installation

1. Unzip this archive.
2. Open Chrome and go to chrome://extensions.
3. Enable Developer mode in the top-right corner.
4. Click Load unpacked.
5. Select the unzipped URL Redirector folder.
6. Open the extension options page to configure redirect rules.
'@

Set-Content -LiteralPath (Join-Path $packageRoot 'README.txt') -Value $readme -Encoding UTF8

Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -Force

Write-Host "Build completed:"
Write-Host "  Package: $packageRoot"
Write-Host "  Archive: $zipPath"
