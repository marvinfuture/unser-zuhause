$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = Join-Path $projectRoot '.runtime'
$configPath = Join-Path $runtimeRoot 'config.json'

# Liefert die portable Node-Laufzeit oder eine bereits installierte Alternative; bricht ohne Laufzeit ab.
function Get-ZuhauseNode {
    $portable = Join-Path $projectRoot '.tools\node-v26.13.1-win-x64\node.exe'
    if (Test-Path -LiteralPath $portable) { return $portable }
    $installed = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($installed) { return $installed.Source }
    throw 'Node.js fehlt. Die portable Laufzeit unter .tools installieren oder Node LTS einrichten.'
}

# Liest die lokale Betriebskonfiguration und liefert beim ersten Start sichere Standardwerte für localhost.
function Read-ZuhauseConfig {
    if (Test-Path -LiteralPath $configPath) { return Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json }
    return [pscustomobject]@{ dataDir=(Join-Path $runtimeRoot 'data'); origin='http://localhost:3210'; port=3210; https=$false; lanIp=''; hostname=''; backupDir='' }
}

# Speichert Betriebspfade und Adressen im von Git ausgeschlossenen Laufzeitordner; keine Kennwörter aufnehmen.
function Save-ZuhauseConfig($Config) {
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    $Config | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $configPath
}

# Verlangt für Firewall und Autostart ein bereits erhöhtes Fenster, ohne selbst eine UAC-Abfrage zu starten.
function Assert-ZuhauseAdmin {
    $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Dieser Einrichtungsschritt braucht ein als Administrator geöffnetes PowerShell-Fenster. Es wird keine automatische Erhöhung gestartet.' }
}

# Erkennt den eigenen laufenden Supervisor anhand von Prozess-ID, Startzeit und Skriptpfad; fremde Prozesse bleiben unberührt.
function Test-ZuhauseSupervisor {
    $pidPath = Join-Path $runtimeRoot 'supervisor.json'
    if (-not (Test-Path -LiteralPath $pidPath)) { return $false }
    try {
        $saved = Get-Content -Raw -LiteralPath $pidPath | ConvertFrom-Json
        $process = Get-Process -Id $saved.pid -ErrorAction Stop
        $details = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$saved.pid)
        return ($process.StartTime.ToUniversalTime().ToString('o') -eq $saved.startedAt -and $details.CommandLine -like ('*' + (Join-Path $projectRoot 'scripts\Run.ps1') + '*'))
    } catch { return $false }
}

# Beschränkt die Dateiberechtigungen für lokale Geheimnisse auf das aktuelle Windows-Konto und SYSTEM.
function Protect-ZuhauseFile([string]$Path) {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl=Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true,$false)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
    Set-Acl -LiteralPath $Path -AclObject $acl
}

# Beschränkt den dedizierten Datenordner samt vererbten Rechten auf das aktuelle Konto und SYSTEM.
function Protect-ZuhauseDirectory([string]$Path) {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl=Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($name in @($identity,'SYSTEM')) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($name,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
