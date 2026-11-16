. (Join-Path $PSScriptRoot 'Common.ps1')
$config=Read-ZuhauseConfig
$certificate=Join-Path $config.dataDir 'caddy\pki\authorities\local\root.crt'
if (-not (Test-Path -LiteralPath $certificate)) { throw 'Das lokale Zertifikat fehlt. Zuerst HTTPS einrichten und die App starten.' }
$cert=New-Object Security.Cryptography.X509Certificates.X509Certificate2($certificate)
Import-Certificate -FilePath $certificate -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
$publicCopy=Join-Path $runtimeRoot 'Zuhause-Zertifikat.crt'
Copy-Item -LiteralPath $certificate -Destination $publicCopy -Force
Write-Host ('Zertifikat für den aktuellen Windows-Benutzer vertraut. Fingerabdruck: '+$cert.Thumbprint)
Write-Host ('Nur diese öffentliche Zertifikatsdatei auf eure Handys übertragen: '+$publicCopy)
Write-Host 'Private Schlüssel aus dem Caddy-Datenordner nicht weitergeben.'
