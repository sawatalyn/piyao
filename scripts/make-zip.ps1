param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [Parameter(Mandatory = $true)][string]$DestinationZip
)
# Builds a ZIP whose entry names use '/' (APPNOTE 4.4.17), prefixed with the package folder
# name. Compress-Archive on PowerShell 5.1 writes '\' separators, and Info-ZIP unzip then
# creates one flat file per entry instead of a directory tree - a package that only unpacks
# correctly on Windows is not "extract and deploy".
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

if (-not (Test-Path -LiteralPath $SourceDir -PathType Container)) {
  Write-Output ('SOURCE_MISSING=' + $SourceDir)
  exit 2
}
$src = (Resolve-Path -LiteralPath $SourceDir).Path.TrimEnd('\')
$prefix = Split-Path -Leaf $src

if (Test-Path -LiteralPath $DestinationZip) { Remove-Item -LiteralPath $DestinationZip -Force }

# Entry names are kept ASCII by the packaging step (demo filenames are ASCII, titles stay
# Chinese). That is deliberate: .NET Framework writes non-ASCII names in the machine ANSI
# codepage without the UTF-8 flag (and its ZipFile.Open has no entryNameEncoding overload
# on the .NET Framework that PowerShell 5.1 ships), so a CJK name that Explorer reads as
# cp936 is read as cp437 by Info-ZIP unzip on Linux - the file unpacks to a mojibake name
# and the backend can no longer find it. ASCII is the only encoding every reader agrees on.
$zip = [System.IO.Compression.ZipFile]::Open($DestinationZip, [System.IO.Compression.ZipArchiveMode]::Create)
$nDir = 0
$nFile = 0
try {
  foreach ($d in Get-ChildItem -LiteralPath $src -Recurse -Directory) {
    $rel = $d.FullName.Substring($src.Length).TrimStart('\') -replace '\\', '/'
    [void]$zip.CreateEntry($prefix + '/' + $rel + '/')
    $nDir = $nDir + 1
  }
  foreach ($f in Get-ChildItem -LiteralPath $src -Recurse -File) {
    $rel = $f.FullName.Substring($src.Length).TrimStart('\') -replace '\\', '/'
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $f.FullName, ($prefix + '/' + $rel), [System.IO.Compression.CompressionLevel]::Optimal)
    $nFile = $nFile + 1
  }
} finally {
  $zip.Dispose()
}

# Read the central directory back: one backslash in a name means the tree will not
# materialise on non-Windows machines, so this build is rejected here rather than shipped.
$check = [System.IO.Compression.ZipFile]::OpenRead($DestinationZip)
$bad = 0
$nonAscii = 0
$total = 0
try {
  foreach ($e in $check.Entries) {
    $total = $total + 1
    if ($e.FullName.Contains('\')) {
      $bad = $bad + 1
      if ($bad -le 3) { Write-Output ('BAD_ENTRY=[' + $e.FullName + ']') }
    }
    if ($e.FullName -match '[^\x20-\x7E]') {
      $nonAscii = $nonAscii + 1
      if ($nonAscii -le 3) { Write-Output ('NON_ASCII_ENTRY=[' + $e.FullName + ']') }
    }
  }
} finally { $check.Dispose() }

Write-Output ('DIRS=' + $nDir + ' FILES=' + $nFile + ' ENTRIES_READBACK=' + $total + ' BACKSLASH_ENTRIES=' + $bad + ' NON_ASCII_ENTRIES=' + $nonAscii)
if ($bad -gt 0) { Write-Output 'RESULT=REJECT'; exit 1 }
if ($nonAscii -gt 0) { Write-Output 'RESULT=REJECT'; exit 1 }
if ($nFile -eq 0) { Write-Output 'RESULT=EMPTY'; exit 1 }
Write-Output 'RESULT=OK'
