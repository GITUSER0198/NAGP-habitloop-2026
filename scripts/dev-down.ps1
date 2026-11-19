$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location -LiteralPath $projectRoot
try {
    Write-Host '[1 of 1] Stopping HabitLoop containers. Project data is retained.'
    docker compose down
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop HabitLoop.' }
    Write-Host 'HabitLoop stopped.'
} finally {
    Pop-Location
}
