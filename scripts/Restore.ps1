param([Parameter(Mandatory=$true)][string]$RepositoryDir,[Parameter(Mandatory=$true)][string]$SnapshotId,[Parameter(Mandatory=$true)][string]$TargetDir)
. (Join-Path $PSScriptRoot 'Common.ps1')
$node=Get-ZuhauseNode
$secret=Read-Host 'Sicherungskennwort' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
Push-Location $projectRoot
try {
    $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $plain | & $node --import tsx (Join-Path $PSScriptRoot 'backup-cli.ts') restore $RepositoryDir $SnapshotId $TargetDir
    if ($LASTEXITCODE -ne 0) { throw 'Wiederherstellung fehlgeschlagen; Meldung oben beachten.' }
} finally { $plain=$null;[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);Pop-Location }
