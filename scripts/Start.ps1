# Startet den eigenen Supervisor unsichtbar; übernimmt optional einen Datenpfad und öffnet die konfigurierte App-Adresse.
param([string]$DataDir, [switch]$OpenBrowser)
. (Join-Path $PSScriptRoot 'Common.ps1')

# Wartet vor dem Browseraufruf höchstens 45 Sekunden auf die konfigurierte App-Adresse; ein fehlgeschlagener Start verweist auf die Protokolle.
function Wait-ZuhauseReady([string]$Origin, [Diagnostics.Process]$Supervisor) {
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt 45) {
        if ($Supervisor -and $Supervisor.HasExited) {
            throw 'Der App-Start ist fehlgeschlagen. Bitte .runtime\logs\build.out.log, build.err.log und app.err.log prüfen. Der Browser wurde nicht geöffnet.'
        }
        try {
            $response=Invoke-WebRequest -UseBasicParsing -Uri $Origin -Method Head -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) { return }
        } catch {
            # Während des lokalen Builds oder HTTPS-Starts ist die Adresse kurzzeitig noch nicht erreichbar.
        }
        Start-Sleep -Milliseconds 300
    }
    throw 'Die App-Adresse ist noch nicht bereit. Bitte .runtime\logs\build.out.log, build.err.log, app.err.log und https.err.log prüfen; bei HTTPS außerdem das Zertifikatsvertrauen. Der Browser wurde nicht geöffnet. Einen noch laufenden Build abwarten und Start.ps1 -OpenBrowser erneut aufrufen.'
}

$node=Get-ZuhauseNode
$buildHelper=Join-Path $PSScriptRoot 'build-state.ts'
$config=Read-ZuhauseConfig
if (Test-ZuhauseSupervisor) {
    & $node $buildHelper check
    if ($LASTEXITCODE -ne 0) { throw 'Die laufende App hat eine veraltete oder beschädigte Oberfläche. Zuerst scripts\Stop.ps1 und danach scripts\Start.ps1 ausführen. Während des Betriebs wird nicht neu gebaut.' }
    Write-Host 'Unser Zuhause läuft bereits.'
    if ($OpenBrowser) {
        Wait-ZuhauseReady -Origin $config.origin
        Start-Process $config.origin
    }
    exit 0
}
if ($DataDir) { $config.dataDir=[IO.Path]::GetFullPath($DataDir) }
Save-ZuhauseConfig $config
$occupied=Get-NetTCPConnection -State Listen -LocalPort $config.port -ErrorAction SilentlyContinue
if ($occupied) { throw ('Port ' + $config.port + ' ist bereits belegt. Einen vorhandenen Testserver zuerst beenden; fremde Prozesse werden nicht gestoppt.') }
$stopFile=Join-Path $runtimeRoot 'stop.request'
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
$runScript=Join-Path $PSScriptRoot 'Run.ps1'
$arguments='-NoProfile -ExecutionPolicy Bypass -File "' + $runScript + '"'
$supervisor=Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
Write-Host ('Start angefordert. Adresse: ' + $config.origin)
Write-Host 'Die Oberfläche wird vor dem Serverstart geprüft und bei Bedarf lokal gebaut. Das kann einen Moment dauern.'
Write-Host 'Protokolle: .runtime\logs (Build: build.out.log und build.err.log). Der Server bleibt auf diesem Windows-PC.'
if ($OpenBrowser) {
    Wait-ZuhauseReady -Origin $config.origin -Supervisor $supervisor
    Start-Process $config.origin
}
