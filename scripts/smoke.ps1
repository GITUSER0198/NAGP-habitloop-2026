param([string]$BASE_URL = $env:BASE_URL)
$ErrorActionPreference = 'Stop'
if (-not $BASE_URL) { $BASE_URL = 'http://localhost:47810' }
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
try {
    & npm --prefix $projectRoot run smoke --silent -- --base-url $BASE_URL
    exit $LASTEXITCODE
} catch {
    Write-Output "FAIL: smoke runner: $_"
    exit 1
}
