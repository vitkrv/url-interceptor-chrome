$ErrorActionPreference = 'Stop'

# Reuse the local build so CI packages exactly the same extension files.
& (Join-Path $PSScriptRoot 'build.ps1')

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json

if ($env:GITHUB_OUTPUT) {
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding UTF8 -Value @(
        'archive_path=dist/URL Redirector.zip',
        "version=$($package.version)"
    )
}
