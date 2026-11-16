. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-ZuhauseAdmin
$config=Read-ZuhauseConfig
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) { throw 'Vor dem Autostart zuerst die Anwendung bauen und lokal prüfen.' }
Write-Host 'Die Aufgabe wird beim Windows-Start unter eurem Windows-Benutzerkonto ausgeführt, auch ohne Anmeldung.'
Write-Host 'Dafür benötigt die Windows-Aufgabenplanung das Kennwort dieses Kontos (keine Windows-Hello-PIN).'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$credential=Get-Credential -UserName $identity -Message 'Windows-Konto für Unser Zuhause. Das Passwort wird nur an die Aufgabenplanung übergeben.'
if (-not $credential) { throw 'Keine Zugangsdaten eingegeben; nichts registriert.' }
if ($credential.UserName -ne $identity) { throw 'Dasselbe Windows-Konto wie bei Configure-Backup verwenden, damit DPAPI den Sicherungsschlüssel lesen kann.' }
$run=Join-Path $PSScriptRoot 'Run.ps1'
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$run+'"') -WorkingDirectory $projectRoot
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 100 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$plain=$credential.GetNetworkCredential().Password
try { Register-ScheduledTask -TaskName 'Unser Zuhause' -Action $action -Trigger $trigger -Settings $settings -Description 'Private Renovierungsapp; nur im eingerichteten Heimnetz.' -User $credential.UserName -Password $plain -RunLevel Limited -Force | Out-Null } finally { $plain=$null;$credential=$null }
Write-Host 'Autostart registriert. Nach einem kontrollierten Windows-Neustart ohne Anmeldung von einem anderen Gerät prüfen.'
Write-Host 'Stop.ps1 bleibt wirksam bis Start.ps1 den Stoppwunsch aufhebt. Zum Start nach einem bewussten Stopp Start.ps1 verwenden.'
