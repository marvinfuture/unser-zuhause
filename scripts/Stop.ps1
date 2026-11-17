# Fordert einen anhaltenden Stopp des eigenen Supervisors an; Start.ps1 hebt diesen Stoppwunsch wieder auf.
. (Join-Path $PSScriptRoot 'Common.ps1')
if (-not (Test-ZuhauseSupervisor)) { Write-Host 'Kein von diesen Skripten gestarteter Server läuft.'; exit 0 }
Set-Content -LiteralPath (Join-Path $runtimeRoot 'stop.request') -Value 'stop' -Encoding ASCII
for ($attempt=0;$attempt -lt 15;$attempt++) { if (-not (Test-ZuhauseSupervisor)) { Write-Host 'Unser Zuhause wurde gestoppt.'; exit 0 }; Start-Sleep -Milliseconds 500 }
throw 'Der Supervisor hat noch nicht reagiert. Protokolle prüfen. Fremde Prozesse wurden nicht beendet.'
