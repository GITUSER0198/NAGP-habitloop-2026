param([string]$BASE_URL = $env:BASE_URL)
$ErrorActionPreference = 'Stop'
if (-not $BASE_URL) { $BASE_URL = 'http://localhost:47810' }
$pythonCommand = if ($env:PYTHON) { $env:PYTHON } else { 'python' }
try {
    & $pythonCommand (Join-Path $PSScriptRoot 'smoke.py') --base-url $BASE_URL
    exit $LASTEXITCODE
} catch {
    Write-Output "FAIL: smoke runner: $_"
    exit 1
}
