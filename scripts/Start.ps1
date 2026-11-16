param([string]$DataDir, [switch]$OpenBrowser)
. (Join-Path $PSScriptRoot 'Common.ps1')
if (Test-ZuhauseSupervisor) { Write-Host 'Unser Zuhause läuft bereits.'; exit 0 }
$config=Read-ZuhauseConfig
if ($DataDir) { $config.dataDir=[IO.Path]::GetFullPath($DataDir) }
Save-ZuhauseConfig $config
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) { throw 'Die Oberfläche ist noch nicht gebaut. Zuerst scripts\Build.ps1 ausführen.' }
$occupied=Get-NetTCPConnection -State Listen -LocalPort $config.port -ErrorAction SilentlyContinue
if ($occupied) { throw ('Port ' + $config.port + ' ist bereits belegt. Einen vorhandenen Testserver zuerst beenden; fremde Prozesse werden nicht gestoppt.') }
$stopFile=Join-Path $runtimeRoot 'stop.request'
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
$runScript=Join-Path $PSScriptRoot 'Run.ps1'
$arguments='-NoProfile -ExecutionPolicy Bypass -File "' + $runScript + '"'
Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
Write-Host ('Start angefordert. Adresse: ' + $config.origin)
Write-Host 'Protokolle: .runtime\logs. Der Server bleibt auf diesem Windows-PC.'
if ($OpenBrowser) { Start-Process $config.origin }
