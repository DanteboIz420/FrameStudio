param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw 'Use a new, empty destination for the extraction check.' }
$archiveShell = New-Object -ComObject Shell.Application
$folder = $archiveShell.NameSpace($archivePath)
if ($null -eq $folder -or $folder.Items().Count -eq 0) { throw 'Windows Explorer cannot list this archive.' }
Write-Output ('Windows Explorer visible entries: ' + $folder.Items().Count)
Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath
foreach ($relative in @('Frame Studio.exe', 'resources\engine\ffmpeg.exe', 'resources\engine\ffprobe.exe', 'resources\engine\LICENSE')) {
    if (!(Test-Path -LiteralPath (Join-Path $destinationPath $relative))) { throw ('Missing extracted file: ' + $relative) }
}
Write-Output ('Windows extraction verified: ' + $destinationPath)
