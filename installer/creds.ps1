# Bianwang - locate and open the credential note the backend writes at startup.
#
# The file is named in Chinese. A .cmd cannot carry that name (cmd.exe parses
# batch in the machine's OEM codepage, so the literal arrives mangled), and
# handing the path back to batch through a temp file is worse: PowerShell's own
# ">" redirection is UTF-16, which cmd then reads as an empty string. So the
# name is rebuilt from its code points here, and everything - finding, printing,
# opening - stays inside PowerShell. Exit code is the only thing that crosses.
#
#   0 found (and opened, unless -Show)
#   2 not created yet; it appears on the backend's first start

param(
  [string]$Root = '',
  [switch]$Show
)

# The .cmd wrapper does not pass -Root: `powershell -File` keeps the argument's
# quotes verbatim, so a path handed over that way arrives as `"C:\site"` and
# Resolve-Path fails on it (measured). An environment variable crosses the
# cmd -> process boundary intact, spaces included, so that is the channel.
if (-not $Root) {
  if ($env:BW_SITE_ROOT) { $Root = $env:BW_SITE_ROOT }
  else { $Root = Split-Path -Parent $PSScriptRoot }
}

$name = [string][char]0x53E3 + [string][char]0x4EE4 + '.txt'

# Resolve-Path's failure is a NON-terminating error: inside a bare try/catch it
# prints its own red line and execution continues with $resolved still $null,
# which took every later Test-Path/Get-Item down and ended in "[ok] found" with
# exit code 0 for a directory that has no such file. -ErrorAction Stop makes the
# catch actually catch it.
try {
  $resolved = (Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path
} catch {
  Write-Host '[-] site root not readable:' $Root
  exit 1
}

if (-not $resolved) {
  Write-Host '[-] site root resolved to nothing:' $Root
  exit 1
}

$target = Join-Path $resolved $name

if (-not (Test-Path -LiteralPath $target)) {
  Write-Host '[ ] not created yet - it appears the first time the backend starts.'
  Write-Host '    expected location:' $target
  Write-Host '    until then the factory login is the one in the backend startup banner.'
  exit 2
}

$item = Get-Item -LiteralPath $target
Write-Host '[ok] found' $item.FullName
Write-Host '     size' $item.Length 'bytes, written' $item.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
Write-Host ''
Write-Host '    It is plaintext and holds every login on this site, including the'
Write-Host '    mirrored library passwords. Anyone who can read it can sign in.'
Write-Host '    Do not mail it, commit it, or leave it on a share. The backend'
Write-Host '    regenerates it on every start, so deleting it once you have changed'
Write-Host '    the passwords is fine.'

if ($Show) {
  Write-Host ''
  Write-Host '    (asked not to open it - the path is above)'
  exit 0
}

Start-Process -FilePath notepad -ArgumentList $item.FullName | Out-Null
Write-Host ''
Write-Host '    opened in Notepad.'
exit 0
