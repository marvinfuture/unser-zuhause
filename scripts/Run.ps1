# Überwacht die eigenen App- und HTTPS-Prozesse; Start.ps1 oder die Aufgabenplanung startet diesen Supervisor unsichtbar.
. (Join-Path $PSScriptRoot 'Common.ps1')
$node=Get-ZuhauseNode
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$lockPath=Join-Path $runtimeRoot 'supervisor.lock'
try { $lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) } catch { exit 0 }
$owned=@{}
try {
    $self=Get-Process -Id $PID
    @{pid=$PID;startedAt=$self.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'supervisor.json') -Encoding UTF8
    $config=Read-ZuhauseConfig
    if (Test-Path -LiteralPath (Join-Path $runtimeRoot 'stop.request')) { return }
    $occupied=Get-NetTCPConnection -State Listen -LocalPort $config.port -ErrorAction SilentlyContinue
    if ($occupied) { throw ('Port ' + $config.port + ' ist bereits belegt. Vor einem Neubau den vorhandenen Server beenden.') }
    $logs=Join-Path $runtimeRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logs | Out-Null
    # Der Supervisor-Lock verhindert parallele Starts; vor dem Serverstart wird ausschließlich die Oberfläche abgeglichen.
    $buildArguments='"'+(Join-Path $PSScriptRoot 'build-state.ts')+'" ensure'
    $build=Start-Process -FilePath $node -ArgumentList $buildArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $logs 'build.out.log') -RedirectStandardError (Join-Path $logs 'build.err.log')
    if ($build.ExitCode -ne 0) { throw 'Die Oberfläche konnte nicht aktualisiert werden. Siehe .runtime\logs\build.out.log und build.err.log. Die App wurde nicht gestartet.' }
    $env:DATA_DIR=[IO.Path]::GetFullPath($config.dataDir)
    $env:APP_ORIGIN=$config.origin
    $env:PORT=[string]$config.port
    $env:SECURE_COOKIES=([bool]$config.https).ToString().ToLowerInvariant()
    $env:NODE_ENV='production'
    $env:UZ_BACKUP_DIR=$config.backupDir
    $secretPath=Join-Path $runtimeRoot 'backup-key.dpapi'
    if ($config.backupDir -and (Test-Path -LiteralPath $secretPath)) {
        $secure=Get-Content -Raw -LiteralPath $secretPath | ConvertTo-SecureString
        $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $env:UZ_BACKUP_PASSPHRASE=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
    New-Item -ItemType Directory -Force -Path $env:DATA_DIR | Out-Null
    Protect-ZuhauseDirectory $env:DATA_DIR
    $config | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $env:DATA_DIR 'runtime-config.json')
    # Startet einen verwalteten Prozess ohne sichtbares Fenster und begrenzt dessen Protokolle durch Rotation beim Neustart.
    function Launch-Owned([string]$Name,[string]$Executable,[string]$Arguments) {
        foreach ($suffix in @('out','err')) {
            $logPath=Join-Path $logs ($Name+'.'+$suffix+'.log')
            if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 5MB) {
                $oldPath=$logPath+'.previous'; if (Test-Path -LiteralPath $oldPath) { Remove-Item -LiteralPath $oldPath }; Move-Item -LiteralPath $logPath -Destination $oldPath
            }
        }
        return Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs ($Name+'.out.log')) -RedirectStandardError (Join-Path $logs ($Name+'.err.log'))
    }
    while (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'stop.request'))) {
        if (-not $owned.app -or $owned.app.HasExited) { $owned.app=Launch-Owned 'app' $node ('--import tsx "'+(Join-Path $projectRoot 'server\index.ts')+'"') }
        if ($config.https -and (-not $owned.https -or $owned.https.HasExited)) {
            $caddy=Join-Path $projectRoot '.tools\caddy\caddy.exe'; $caddyfile=Join-Path $runtimeRoot 'Caddyfile'
            if (-not (Test-Path -LiteralPath $caddy)) { throw 'Caddy fehlt. HTTPS-Einrichtung erneut ausführen.' }
            $owned.https=Launch-Owned 'https' $caddy ('run --config "'+$caddyfile+'" --adapter caddyfile')
        }
        Start-Sleep -Seconds 3
    }
} finally {
    foreach ($child in $owned.Values) { if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue } }
    $env:UZ_BACKUP_PASSPHRASE=$null
    Remove-Item -LiteralPath (Join-Path $runtimeRoot 'supervisor.json') -Force -ErrorAction SilentlyContinue
    $lock.Dispose()
}
