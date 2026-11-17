# Bereitet Caddy für die angegebene Heimnetzadresse vor und richtet auf Wunsch eine eng begrenzte Firewallregel ein.
param(
    [Parameter(Mandatory=$true)][string]$LanIp,
    [Parameter(Mandatory=$true)][string]$AllowedSubnet,
    [string]$Hostname,
    [switch]$ConfigureFirewall
)
. (Join-Path $PSScriptRoot 'Common.ps1')
if (Test-ZuhauseSupervisor) { throw 'App zuerst mit Stop.ps1 beenden, bevor die Adresse geändert wird.' }
if ($ConfigureFirewall) { Assert-ZuhauseAdmin }
$ip=$null
if (-not [Net.IPAddress]::TryParse($LanIp,[ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'LanIp muss eine private IPv4-Adresse sein.' }
$bytes=$ip.GetAddressBytes()
if (-not ($bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168))) { throw 'Nur eine private Heimnetz-IP ist erlaubt.' }
if ($AllowedSubnet -notmatch '^([0-9]{1,3}\.){3}[0-9]{1,3}/([1-9]|[12][0-9]|3[0-2])$') { throw 'AllowedSubnet muss dein IPv4-Heimnetz als CIDR angeben, zum Beispiel 192.168.1.0/24 (durch dein eigenes Netz ersetzen).' }
$networkParts=$AllowedSubnet.Split('/');$network=[Net.IPAddress]::Parse($networkParts[0]);$prefix=[int]$networkParts[1]
$minimumPrefix=if ($bytes[0] -eq 10) { 8 } elseif ($bytes[0] -eq 172) { 12 } else { 16 }
if ($prefix -lt $minimumPrefix) { throw 'Die Freigabe darf nicht über den privaten Adressbereich hinausgehen.' }
$ipBits=[Convert]::ToString([BitConverter]::ToUInt32(($bytes[3..0]),0),2).PadLeft(32,'0')
$netBytes=$network.GetAddressBytes();$netBits=[Convert]::ToString([BitConverter]::ToUInt32(($netBytes[3..0]),0),2).PadLeft(32,'0')
if ($ipBits.Substring(0,$prefix) -ne $netBits.Substring(0,$prefix)) { throw 'Die LAN-IP liegt nicht im freigegebenen Subnetz.' }
if ($prefix -lt 32 -and $netBits.Substring($prefix).Contains('1')) { throw 'AllowedSubnet muss die Netzadresse enthalten, etwa .0/24.' }
if (-not $Hostname) { $Hostname=$LanIp }
if ($Hostname -ne $LanIp -and $Hostname -notmatch '^[a-z0-9][a-z0-9.-]*\.home\.arpa$') { throw 'Als Hostname ist die LAN-IP oder ein lokaler Name unter home.arpa vorgesehen.' }
if (-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanIp -ErrorAction SilentlyContinue)) { throw 'Diese LAN-IP ist diesem PC nicht zugewiesen.' }
$config=Read-ZuhauseConfig
$caddyDir=Join-Path $projectRoot '.tools\caddy'
New-Item -ItemType Directory -Force -Path $caddyDir | Out-Null
$caddy=Join-Path $caddyDir 'caddy.exe'
if (-not (Test-Path -LiteralPath $caddy)) {
    $release=Invoke-RestMethod -Uri 'https://api.github.com/repos/caddyserver/caddy/releases/latest'
    $asset=$release.assets | Where-Object { $_.name -match '_windows_amd64\.zip$' } | Select-Object -First 1
    $checksums=$release.assets | Where-Object { $_.name -match '_checksums\.txt$' } | Select-Object -First 1
    if (-not $asset -or -not $checksums) { throw 'Passendes offizielles Caddy-Paket oder Prüfsumme nicht gefunden.' }
    $zip=Join-Path $caddyDir $asset.name
    Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $zip
    $sumText=(Invoke-WebRequest -UseBasicParsing -Uri $checksums.browser_download_url).Content
    $sumLine=$sumText -split "`n" | Where-Object { $_ -match ([regex]::Escape($asset.name)+'\s*$') }
    $expected=($sumLine -split '\s+')[0]
    if (-not $expected -or (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash -ne $expected) { throw 'Caddy-Prüfsumme stimmt nicht.' }
    Expand-Archive -LiteralPath $zip -DestinationPath $caddyDir -Force
    $release.tag_name | Set-Content -LiteralPath (Join-Path $caddyDir 'version.txt') -Encoding ASCII
}
$storage=([IO.Path]::GetFullPath((Join-Path $config.dataDir 'caddy'))).Replace('\','/')
$caddyfile=@"
{
    admin 127.0.0.1:2019
    auto_https disable_redirects
    skip_install_trust
    storage file_system {
        root "$storage"
    }
    servers {
        protocols h1 h2
    }
}

https://$Hostname {
    bind $LanIp
    tls internal
    @outside not remote_ip $AllowedSubnet
    respond @outside "Nur im Heimnetz erreichbar." 403
    reverse_proxy 127.0.0.1:$($config.port)
}
"@
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$caddyfilePath=Join-Path $runtimeRoot 'Caddyfile'
$utf8=New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($caddyfilePath,$caddyfile,$utf8)
# Caddy schreibt auch erfolgreiche Statusmeldungen auf stderr. Unter Windows PowerShell 5.1
# darf dies nicht als Abbruch gelten; allein der Exitcode entscheidet über die Validierung.
$previousErrorAction=$ErrorActionPreference
try {
    $ErrorActionPreference='Continue'
    $validationOutput=@(& $caddy adapt --config $caddyfilePath --adapter caddyfile --validate 2>&1)
    $validationExitCode=$LASTEXITCODE
} finally { $ErrorActionPreference=$previousErrorAction }
if ($validationExitCode -ne 0) { throw ('Caddy-Konfiguration konnte nicht validiert werden: ' + ($validationOutput -join "`n")) }
$config.origin='https://'+$Hostname;$config.https=$true;$config.lanIp=$LanIp;$config.hostname=$Hostname
Save-ZuhauseConfig $config
if ($ConfigureFirewall) {
    $ruleName='UnserZuhause-HTTPS-Private'
    $existing=Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($existing) { $existing | Remove-NetFirewallRule }
    New-NetFirewallRule -Name $ruleName -DisplayName 'Unser Zuhause HTTPS im privaten Heimnetz' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -LocalAddress $LanIp -RemoteAddress $AllowedSubnet -Program $caddy -Profile Private | Out-Null
    Write-Host 'Firewallregel für das angegebene private IPv4-Heimnetz angelegt. IPv6 wird von Caddy nicht gebunden.'
} else { Write-Host 'Keine Firewallregel geändert. Für andere Geräte ist der gesonderte Administrator-Schritt erforderlich.' }
Write-Host ('HTTPS vorbereitet: '+$config.origin)
Write-Host 'Die IP im Router reservieren. Bei einem Hostnamen zusätzlich lokalen DNS-Eintrag einrichten.'
Write-Host 'Nach Start.ps1: Trust-LocalCertificate.ps1 ausführen und das öffentliche Zertifikat auf den Handys installieren.'
