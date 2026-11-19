# Prüft die TypeScript-Typen und erzeugt die auslieferbare Oberfläche in dist; verändert keine Haushaltsdaten.
. (Join-Path $PSScriptRoot 'Common.ps1')
if (Test-ZuhauseSupervisor) { throw 'Vor dem Neubau zuerst scripts\Stop.ps1 ausführen. Eine laufende Oberfläche wird nicht ersetzt.' }
$node=Get-ZuhauseNode
$config=Read-ZuhauseConfig
if (Get-NetTCPConnection -State Listen -LocalPort $config.port -ErrorAction SilentlyContinue) { throw 'Der App-Port ist belegt. Den vorhandenen Server vor dem Neubau beenden.' }
& $node (Join-Path $PSScriptRoot 'build-state.ts') build
if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen. Die Oberfläche bleibt bis zu einem erfolgreichen Build unbestätigt.' }
