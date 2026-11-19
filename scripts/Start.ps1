# Startet oder aktualisiert die lokale Installation und meldet die geprüfte Browseradresse.
param([string]$DataDir, [switch]$OpenBrowser)
. (Join-Path $PSScriptRoot 'Common.ps1')

# Schließt gleichzeitige Start- und Aktualisierungsanforderungen für denselben Projektordner aus.
function Enter-ZuhauseStartLock {
    $path = Join-Path $runtimeRoot 'start.lock'
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        try { return [IO.File]::Open($path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch [IO.IOException] {
            if ($watch.Elapsed.TotalMinutes -ge 15) { throw 'Ein anderer Start ist noch beschäftigt. Bitte die Ausgabe des ersten Starts und .runtime\logs prüfen.' }
            Start-Sleep -Milliseconds 500
        }
    }
}

# Zeigt den letzten konkreten Fehler des versteckt gestarteten Supervisors im aufrufenden Fenster.
function Get-ZuhauseStartFailure {
    $path = Join-Path $runtimeRoot 'logs\supervisor.err.log'
    $detail = if (Test-Path -LiteralPath $path) { (Get-Content -LiteralPath $path -Encoding UTF8 -Tail 3) -join ' ' }
    return "Der Start ist fehlgeschlagen. $detail Protokolle: .runtime\logs (supervisor.err.log, install.err.log, build.out.log, app.err.log und https.err.log)."
}

# Wartet auf den passenden Serverstand und auf die echte Startseite über die konfigurierte Adresse.
function Wait-ZuhauseReady([Diagnostics.Process]$Supervisor, [string]$Version) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $proxyWait = $null
    $nextUpdate = 15
    $detail = ''
    while ($watch.Elapsed.TotalMinutes -lt 15) {
        $Supervisor.Refresh()
        if ($Supervisor.HasExited) {
            # Möglicherweise hat die Aufgabenplanung den Start gleichzeitig übernommen.
            if (Test-ZuhauseSupervisor) {
                $owner = Get-Content -Raw -Encoding UTF8 -LiteralPath $pidPath | ConvertFrom-Json
                if ($owner.version -eq $Version) { $Supervisor = Get-Process -Id $owner.pid; continue }
            }
            throw (Get-ZuhauseStartFailure)
        }
        $probeCode = 1
        if (Test-Path -LiteralPath $pidPath) {
            $state = Get-Content -Raw -Encoding UTF8 -LiteralPath $pidPath -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($state.started -and $state.version -eq $Version -and $state.pid -eq $Supervisor.Id) {
                $detail = (& $node (Join-Path $PSScriptRoot 'host-ready.ts') $configPath $Version) -join ' '
                $probeCode = $LASTEXITCODE
            }
        }
        if ($probeCode -eq 0) { return }
        if ($probeCode -eq 2) {
            if (-not $proxyWait) { $proxyWait = [Diagnostics.Stopwatch]::StartNew() }
            if ($proxyWait.Elapsed.TotalSeconds -ge 30) {
                throw "$detail. Die konfigurierte Adresse in .runtime\config.json sowie .runtime\logs\https.err.log prüfen."
            }
        } else { $proxyWait = $null }
        if ($watch.Elapsed.TotalSeconds -ge $nextUpdate) {
            Write-Host 'Der Start läuft. Installation und Build können beim ersten Start nach einem Update einige Minuten dauern. Einzelheiten stehen in .runtime\logs.'
            $nextUpdate += 45
        }
        Start-Sleep -Milliseconds 750
    }
    throw "Die App wurde noch nicht als bereit bestätigt. $detail. Fortschritt und Fehler stehen in .runtime\logs."
}

# Prüft zusätzlich zum lokalen Zertifikat, ob auch dieses Windows-Konto der HTTPS-Adresse vertraut.
function Test-ZuhauseWindowsHttps([string]$Origin) {
    $request = [Net.HttpWebRequest]::Create([uri]$Origin)
    $request.Proxy = $null
    $request.Method = 'HEAD'
    $request.Timeout = 6000
    try {
        $response = $request.GetResponse()
        try { return ([int]$response.StatusCode -eq 200) } finally { $response.Close() }
    } catch [Net.WebException] {
        if ($_.Exception.Status -eq [Net.WebExceptionStatus]::TrustFailure -or
            $_.Exception.Status -eq [Net.WebExceptionStatus]::SecureChannelFailure) { return $false }
        throw
    }
}

$node = Get-ZuhauseNode
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$startLock = Enter-ZuhauseStartLock
try {
    $version = & $node (Join-Path $PSScriptRoot 'runtime-state.ts') version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^[a-f0-9]{64}$') { throw 'Der lokale Programmstand konnte nicht gelesen werden.' }
    $config = Read-ZuhauseConfig
    $pidPath = Join-Path $runtimeRoot 'supervisor.json'
    $running = Test-ZuhauseSupervisor
    $newDataDir = if ($DataDir) { [IO.Path]::GetFullPath($DataDir) }
    if ($running) {
        $owner = Get-Content -Raw -Encoding UTF8 -LiteralPath $pidPath | ConvertFrom-Json
        $restart = ($owner.version -ne $version -or ($newDataDir -and $newDataDir -ne $config.dataDir))
        if (-not $restart -and $owner.prepared) {
            & $node (Join-Path $PSScriptRoot 'dependencies.ts') check | Out-Host
            $packagesCurrent = $LASTEXITCODE -eq 0
            & $node (Join-Path $PSScriptRoot 'build-state.ts') check | Out-Host
            $restart = -not $packagesCurrent -or $LASTEXITCODE -ne 0
        }
        if ($restart) {
            Write-Host 'Ein Update oder eine Reparatur ist erforderlich. Der eigene App-Dienst wird neu gestartet.'
            & (Join-Path $PSScriptRoot 'Stop.ps1')
            if ($LASTEXITCODE -ne 0 -or (Test-ZuhauseSupervisor)) { throw 'Der bisherige Dienst konnte nicht beendet werden.' }
            $running = $false
        } else { $supervisor = Get-Process -Id $owner.pid }
    }
    if (-not $running) {
        if ($newDataDir) { $config.dataDir = $newDataDir }
        if ($newDataDir -or -not (Test-Path -LiteralPath $configPath)) { Save-ZuhauseConfig $config }
        $stopFile = Join-Path $runtimeRoot 'stop.request'
        if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
        $runScript = Join-Path $PSScriptRoot 'Run.ps1'
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $runScript + '"'
        Write-Host 'Starte Unser Zuhause. Pakete, Build und Verbindung werden geprüft …'
        $supervisor = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    }
    Wait-ZuhauseReady -Supervisor $supervisor -Version $version
    if ($config.https -and -not (Test-ZuhauseWindowsHttps $config.origin)) {
        Write-Warning ('Der Server liefert die aktuelle App über HTTPS unter ' + $config.origin + '. Windows vertraut dem lokalen Zertifikat noch nicht. Auf diesem PC scripts\Trust-LocalCertificate.ps1 ausführen und Start.ps1 erneut aufrufen.')
        if ($OpenBrowser) { throw 'Das Browserfenster kann nach dem Einrichten des Zertifikatsvertrauens geöffnet werden.' }
    } else {
        Write-Host ('Unser Zuhause ist bereit: ' + $config.origin)
        if ($OpenBrowser) { Start-Process $config.origin }
    }
} finally { $startLock.Dispose() }
