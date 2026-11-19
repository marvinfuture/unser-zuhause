# Überwacht Backend und optionalen HTTPS-Proxy dieses Projektordners.
. (Join-Path $PSScriptRoot 'Common.ps1')
$ErrorActionPreference = 'Stop'
$logs = Join-Path $runtimeRoot 'logs'
$stopFile = Join-Path $runtimeRoot 'stop.request'
$pidFile = Join-Path $runtimeRoot 'supervisor.json'
$owned = @{}

# Veröffentlicht die eigene Identität und die beim Start geladene Version ohne teilweise lesbare JSON-Datei.
function Publish-ZuhauseSupervisor([string]$Version, [bool]$Prepared, [bool]$Started) {
    $self = Get-Process -Id $PID
    $record = @{ pid=$PID; startedAt=$self.StartTime.ToUniversalTime().ToString('o'); version=$Version; prepared=$Prepared; started=$Started }
    $temporary = Join-Path $runtimeRoot ('supervisor.' + $PID + '.tmp')
    try {
        [IO.File]::WriteAllText($temporary, ($record | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        for ($attempt=0; ; $attempt++) {
            try {
                if ([IO.File]::Exists($pidFile)) {
                    $nullBackup = [System.Management.Automation.Language.NullString]::Value
                    [IO.File]::Replace($temporary, $pidFile, $nullBackup)
                } else {
                    [IO.File]::Move($temporary, $pidFile)
                }
                break
            } catch [IO.IOException] {
                # Der parallele Start kann die alte Datei gerade ohne Löschfreigabe lesen.
                if ($attempt -ge 20 -or ($_.Exception.HResult -band 65535) -ne 32) { throw }
                Start-Sleep -Milliseconds 30
            }
        }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

# Startet einen Node-Helfer unter dem Supervisor-Lock und protokolliert Ausgabe, Fehler und Exitcode.
function Invoke-ZuhausePreparation([string]$Name, [string]$Script, [string]$Message) {
    $arguments = '"' + (Join-Path $PSScriptRoot $Script) + '" ensure'
    $result = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $logs ($Name + '.out.log')) -RedirectStandardError (Join-Path $logs ($Name + '.err.log'))
    if ($result.ExitCode -ne 0) {
        throw ($Message + ' Siehe .runtime\logs\' + $Name + '.out.log und ' + $Name + '.err.log (Exitcode ' + $result.ExitCode + ').')
    }
}

# Wartet auf den Listener des neuen eigenen Prozesses. Stoppwünsche werden während des Starts berücksichtigt.
function Wait-ZuhauseListener([Diagnostics.Process]$Child, [int]$Port, [string]$Address, [string]$Name) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 40) {
        if (Test-Path -LiteralPath $stopFile) { return }
        if ($Child.HasExited) {
            throw ($Name + ' wurde vor der Bereitschaft beendet (Exitcode ' + $Child.ExitCode + '). Siehe .runtime\logs\' + $Name + '.err.log.')
        }
        $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -OwningProcess $Child.Id -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -eq $Address } | Select-Object -First 1
        if ($listener) { return }
        Start-Sleep -Milliseconds 250
    }
    throw ($Name + ' hat den konfigurierten TCP-Port ' + $Port + ' nicht an der vorgesehenen Adresse geöffnet. Siehe .runtime\logs\' + $Name + '.err.log.')
}

# Startet nur die eigene ausführbare Datei und wartet vor dem nächsten Schritt auf deren konfigurierten Listener.
function Start-ZuhauseChild([string]$Name, [string]$Executable, [string]$Arguments, [int]$Port, [string]$Address) {
    foreach ($suffix in @('out','err')) {
        $logPath = Join-Path $logs ($Name + '.' + $suffix + '.log')
        if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 0) {
            Move-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force
        }
    }
    $child = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs ($Name + '.out.log')) -RedirectStandardError (Join-Path $logs ($Name + '.err.log'))
    $owned[$Name] = $child
    Wait-ZuhauseListener $child $Port $Address $Name
}

New-Item -ItemType Directory -Force -Path $logs | Out-Null
$lockPath = Join-Path $runtimeRoot 'supervisor.lock'
try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch [IO.IOException] {
    # Freigabeverletzung bedeutet einen aktiven Start. Andere E/A-Fehler sollen sichtbar sein.
    if (($_.Exception.HResult -band 65535) -eq 32) { exit 0 }
    throw
}
try {
    $supervisorLog = Join-Path $logs 'supervisor.err.log'
    [IO.File]::WriteAllText($supervisorLog, '')
    $node = Get-ZuhauseNode
    $config = Read-ZuhauseConfig
    if (Test-Path -LiteralPath $stopFile) { return }
    $version = & $node (Join-Path $PSScriptRoot 'runtime-state.ts') version
    if ($LASTEXITCODE -ne 0 -or -not $version) { throw 'Die installierte App-Version konnte nicht bestimmt werden.' }
    Publish-ZuhauseSupervisor ([string]$version) $false $false
    $occupied = Get-NetTCPConnection -State Listen -LocalPort $config.port -ErrorAction SilentlyContinue
    if ($occupied) { throw ('Der Backend-Port ' + $config.port + ' ist bereits belegt. Der vorhandene Prozess wurde nicht beendet.') }
    if ($config.https) {
        $proxyOrigin = [Uri]$config.origin
        if ($proxyOrigin.Scheme -ne 'https' -or -not $config.lanIp) { throw 'HTTPS-Adresse oder LAN-IP fehlt. Bitte die Heimnetzkonfiguration prüfen.' }
        $caddy = Join-Path $projectRoot '.tools\caddy\caddy.exe'
        $caddyfile = Join-Path $runtimeRoot 'Caddyfile'
        if (-not [IO.File]::Exists($caddy) -or -not [IO.File]::Exists($caddyfile)) {
            throw 'Die HTTPS-Einrichtung ist unvollständig. Caddy oder .runtime\Caddyfile fehlt. Siehe Abschnitt 5 in howto.md.'
        }
        $occupiedProxy = Get-NetTCPConnection -State Listen -LocalPort $proxyOrigin.Port -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -in @($config.lanIp, '0.0.0.0', '::') } | Select-Object -First 1
        if ($occupiedProxy) { throw ('Der HTTPS-Port ' + $proxyOrigin.Port + ' ist bereits belegt. Der vorhandene Prozess wurde nicht beendet.') }
    }
    Invoke-ZuhausePreparation 'install' 'dependencies.ts' 'Die Paketabhängigkeiten konnten nicht bereitgestellt werden.'
    if (Test-Path -LiteralPath $stopFile) { return }
    Invoke-ZuhausePreparation 'build' 'build-state.ts' 'Die Oberfläche konnte nicht aktualisiert werden.'
    if (Test-Path -LiteralPath $stopFile) { return }
    Publish-ZuhauseSupervisor ([string]$version) $true $false
    $env:DATA_DIR = [IO.Path]::GetFullPath($config.dataDir)
    $env:APP_ORIGIN = $config.origin
    $env:PORT = [string]$config.port
    $env:SECURE_COOKIES = ([bool]$config.https).ToString().ToLowerInvariant()
    $env:NODE_ENV = 'production'
    $env:UZ_BACKUP_DIR = $config.backupDir
    $secretPath = Join-Path $runtimeRoot 'backup-key.dpapi'
    if ($config.backupDir -and (Test-Path -LiteralPath $secretPath)) {
        $secure = Get-Content -Raw -LiteralPath $secretPath | ConvertTo-SecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $env:UZ_BACKUP_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
    New-Item -ItemType Directory -Force -Path $env:DATA_DIR | Out-Null
    Protect-ZuhauseDirectory $env:DATA_DIR
    $config | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $env:DATA_DIR 'runtime-config.json')
    $started = $false
    while (-not (Test-Path -LiteralPath $stopFile)) {
        $startApp = -not $owned.app -or $owned.app.HasExited
        $startProxy = $config.https -and (-not $owned.https -or $owned.https.HasExited)
        if ($started -and ($startApp -or $startProxy)) {
            Publish-ZuhauseSupervisor ([string]$version) $true $false
            $started = $false
        }
        if ($startApp) {
            Start-ZuhauseChild 'app' $node ('--import tsx "' + (Join-Path $projectRoot 'server\index.ts') + '"') $config.port '127.0.0.1'
        }
        if ($startProxy -and -not (Test-Path -LiteralPath $stopFile)) {
            Start-ZuhauseChild 'https' $caddy ('run --config "' + $caddyfile + '" --adapter caddyfile') $proxyOrigin.Port $config.lanIp
        }
        if (Test-Path -LiteralPath $stopFile) { break }
        if (-not $started -and -not $owned.app.HasExited -and (-not $config.https -or -not $owned.https.HasExited)) {
            Publish-ZuhauseSupervisor ([string]$version) $true $true
            $started = $true
        }
        Start-Sleep -Seconds 1
    }
} catch {
    $failure = (Get-Date -Format 'o') + ' ' + $_.Exception.Message
    Add-Content -LiteralPath (Join-Path $logs 'supervisor.err.log') -Encoding UTF8 -Value $failure
    throw
} finally {
    foreach ($child in $owned.Values) {
        if ($child -and -not $child.HasExited) {
            try { $child.Kill(); [void]$child.WaitForExit(5000) } catch [InvalidOperationException] {}
        }
    }
    $env:UZ_BACKUP_PASSPHRASE = $null
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    $lock.Dispose()
}
