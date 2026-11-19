# Fordert einen anhaltenden Stopp des eigenen Supervisors an; Start.ps1 hebt diesen Stoppwunsch wieder auf.
. (Join-Path $PSScriptRoot 'Common.ps1')
if (-not (Test-ZuhauseSupervisor)) { Write-Host 'Kein von diesen Skripten gestarteter Server läuft.'; exit 0 }
$owner = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $runtimeRoot 'supervisor.json') | ConvertFrom-Json
$process = Get-Process -Id $owner.pid -ErrorAction SilentlyContinue
Set-Content -LiteralPath (Join-Path $runtimeRoot 'stop.request') -Value 'stop' -Encoding ASCII
# Ein laufender Paketabgleich kann länger dauern. Vor dem Neustart müssen seine Dateizugriffe beendet sein.
if ($process -and -not $process.WaitForExit(900000)) { throw 'Der Supervisor hat den Stopp nicht bestätigt. Bitte .runtime\logs prüfen.' }
Write-Host 'Unser Zuhause wurde gestoppt.'
exit 0
