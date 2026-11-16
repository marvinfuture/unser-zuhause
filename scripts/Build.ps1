. (Join-Path $PSScriptRoot 'Common.ps1')
$node=Get-ZuhauseNode
$env:PATH=(Split-Path -Parent $node)+';'+$env:PATH
Push-Location $projectRoot
try {
    & $node (Join-Path $projectRoot 'node_modules\typescript\bin\tsc') --noEmit
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript-Prüfung fehlgeschlagen.' }
    & $node (Join-Path $projectRoot 'node_modules\vite\bin\vite.js') build
    if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen.' }
} finally { Pop-Location }
