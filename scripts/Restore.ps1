# Stellt einen verschlüsselten Sicherungsstand ausschließlich in einen leeren Zielordner wieder her.
param([Parameter(Mandatory=$true)][string]$RepositoryDir,[Parameter(Mandatory=$true)][string]$SnapshotId,[Parameter(Mandatory=$true)][string]$TargetDir)
. (Join-Path $PSScriptRoot 'Common.ps1')
$node=Get-ZuhauseNode
$secret=Read-Host 'Sicherungskennwort' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$previousOutputEncoding=$global:OutputEncoding
Push-Location $projectRoot
try {
    # Windows PowerShell 5.1 verwendet für native stdin-Pipelines die globale Einstellung,
    # auch wenn dieses Skript aus einem anderen Skript aufgerufen wird. Anschließend wiederherstellen.
    $global:OutputEncoding=New-Object System.Text.UTF8Encoding($false)
    $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $plain | & $node --import tsx (Join-Path $PSScriptRoot 'backup-cli.ts') restore $RepositoryDir $SnapshotId $TargetDir
    if ($LASTEXITCODE -ne 0) { throw 'Wiederherstellung fehlgeschlagen; Meldung oben beachten.' }
} finally { $global:OutputEncoding=$previousOutputEncoding;$plain=$null;[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);Pop-Location }
