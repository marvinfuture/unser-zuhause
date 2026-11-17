# Lädt die geprüfte portable Node-Laufzeit, installiert die festgeschriebenen Pakete und baut die Oberfläche.
. (Join-Path $PSScriptRoot 'Common.ps1')
$version='v26.13.1'
$toolsPath=Join-Path $projectRoot '.tools'
$nodeDir=Join-Path $toolsPath ('node-'+$version+'-win-x64')
$node=Join-Path $nodeDir 'node.exe'
if (-not (Test-Path -LiteralPath $node)) {
    New-Item -ItemType Directory -Force -Path $toolsPath | Out-Null
    $name='node-'+$version+'-win-x64.zip';$archive=Join-Path $toolsPath $name
    Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/'+$version+'/'+$name) -OutFile $archive
    $checks=(Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/'+$version+'/SHASUMS256.txt')).Content
    $line=$checks -split "`n" | Where-Object { $_ -match ([regex]::Escape($name)+'\s*$') }
    $expected=($line -split '\s+')[0]
    if (-not $expected -or (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash -ne $expected) { throw 'Node-Prüfsumme stimmt nicht.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $toolsPath -Force
}
$env:PATH=$nodeDir+';'+$env:PATH
Push-Location $projectRoot
try {
    & $node (Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js') ci
    if ($LASTEXITCODE -ne 0) { throw 'Paketinstallation fehlgeschlagen.' }
    & (Join-Path $PSScriptRoot 'Build.ps1')
} finally { Pop-Location }
Write-Host 'Installation vorbereitet. Mit scripts\Start.ps1 -OpenBrowser lokal starten.'
