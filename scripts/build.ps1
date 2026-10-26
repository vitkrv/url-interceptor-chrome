$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$distRoot = Join-Path $repoRoot 'dist'
$packageRoot = Join-Path $distRoot 'URL Redirector'
$zipPath = Join-Path $distRoot 'URL Redirector.zip'
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json

if ($package.version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -or
    @($package.version.Split('.') | Where-Object { [double]$_ -gt 65535 }).Count -gt 0 -or
    $package.version -eq '0.0.0') {
    throw 'package.json version must contain three integers from 0 to 65535, without leading zeros, and cannot be 0.0.0.'
}

if (Test-Path $distRoot) {
    if ([System.IO.Path]::GetFullPath($distRoot) -ne [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'dist'))) {
        throw 'Build output must be the repository dist directory.'
    }
    Remove-Item -LiteralPath $distRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $packageRoot | Out-Null

$itemsToCopy = @(
    'manifest.json',
    'package.json',
    'background',
    'content',
    'icons',
    'options',
    'popup',
    'shared'
)

foreach ($item in $itemsToCopy) {
    $source = Join-Path $repoRoot $item
    $destination = Join-Path $packageRoot $item

    if (-not (Test-Path $source)) {
        throw "Missing required extension file or directory: $item"
    }

    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

$manifestPath = Join-Path $packageRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifest.version = $package.version
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

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
