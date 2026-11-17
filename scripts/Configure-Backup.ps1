# Speichert das Sicherungsziel und schützt dessen verdeckt eingegebenes Kennwort mit Windows-DPAPI für dieses Konto.
param([Parameter(Mandatory=$true)][string]$RepositoryDir)
. (Join-Path $PSScriptRoot 'Common.ps1')
$config=Read-ZuhauseConfig
$backupPath=[IO.Path]::GetFullPath($RepositoryDir)
$dataPath=[IO.Path]::GetFullPath($config.dataDir).TrimEnd('\')
if ($backupPath.Equals($dataPath,[StringComparison]::OrdinalIgnoreCase) -or $backupPath.StartsWith($dataPath+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Sicherungsziel darf nicht im Datenordner liegen.' }
New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
$password=Read-Host 'Sicherungskennwort (mindestens 12 Zeichen; zusätzlich außerhalb dieses PCs aufbewahren)' -AsSecureString
$confirm=Read-Host 'Sicherungskennwort wiederholen' -AsSecureString
$p1=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($password);$p2=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
try {
    $one=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p1);$two=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p2)
    if ($one.Length -lt 12 -or $one -cne $two) { throw 'Kennwörter stimmen nicht überein oder sind zu kurz.' }
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p1);[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p2);$one=$null;$two=$null }
$config.backupDir=$backupPath;Save-ZuhauseConfig $config
$secretPath=Join-Path $runtimeRoot 'backup-key.dpapi'
$password | ConvertFrom-SecureString | Set-Content -LiteralPath $secretPath -Encoding ASCII
Protect-ZuhauseFile $secretPath
Write-Host 'Sicherungsziel gespeichert. Der Schlüssel ist per Windows-DPAPI für diesen Windows-Benutzer geschützt.'
Write-Host 'App neu starten, Sicherung in den Einstellungen auslösen und einen Wiederherstellungstest durchführen.'
Write-Host 'Ein Ordner auf derselben SSD ist kein unabhängiges Backup. Das tatsächliche Ziel bleibt zu prüfen.'
