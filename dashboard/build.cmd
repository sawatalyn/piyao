@echo off
setlocal
rem ============================================================================
rem  Bianwang dashboard - build the launcher EXE with the C# compiler that
rem  ships with Windows (.NET Framework 4.x). No npm package is added, no
rem  Electron/Python runtime is dragged in.
rem
rem  Output: dashboard\BianwangDashboard.exe
rem  Re-run this after editing dashboard\Dashboard.cs.
rem  NOTE: intentionally ASCII-only - cmd.exe reads .cmd in the OEM codepage,
rem        so non-ASCII comments would render as mojibake.
rem ============================================================================

cd /d "%~dp0"

set "CSC="
if exist "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not defined CSC if exist "%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

if not defined CSC (
  echo [X] No in-box C# compiler found under %WINDIR%\Microsoft.NET\Framework*\v4.0.30319
  echo     The .NET Framework 4.x is a built-in Windows component. Enable it with:
  echo       optionalfeatures.exe   ^(turn on ".NET Framework 4.8 / 4.x Advanced Services"^)
  echo     or install it from: https://dotnet.microsoft.com/download/dotnet-framework
  echo     Without it there is no exe to build - the site itself does NOT need it,
  echo     only this dashboard does.
  exit /b 2
)

echo [*] Using compiler: %CSC%

if not exist "Dashboard.cs" (
  echo [X] Dashboard.cs not next to this script.
  exit /b 2
)

rem csc cannot overwrite a running exe; without this guard the failure surfaces as a
rem bare "error CS0016" that says nothing about the real cause.
rem findstr, not find: a PATH that leads with Git-for-Windows /usr/bin shadows find.exe
rem with GNU find, which then chokes on /i and silently defeats the guard.
tasklist /FI "IMAGENAME eq BianwangDashboard.exe" 2>nul | findstr /i /c:"BianwangDashboard.exe" >nul
if not errorlevel 1 (
  echo [X] BianwangDashboard.exe is still running - close the dashboard window first.
  echo     csc cannot overwrite an exe that is in use.
  exit /b 3
)

if exist "BianwangDashboard.exe" del /q "BianwangDashboard.exe" 2>nul

rem /codepage:65001 is required, not cosmetic: without it csc guesses the source
rem encoding from the machine's ANSI codepage. Dashboard.cs holds Chinese string
rem literals, so a wrong guess bakes mojibake straight into the exe's UI text.
"%CSC%" /nologo /target:winexe /optimize+ /codepage:65001 ^
  /out:BianwangDashboard.exe ^
  /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll ^
  Dashboard.cs
if errorlevel 1 (
  echo [X] compile failed - see the messages above.
  exit /b 1
)

if not exist "BianwangDashboard.exe" (
  echo [X] compiler reported success but produced no exe.
  exit /b 1
)

echo [OK] built dashboard\BianwangDashboard.exe
echo      Run it directly, or use install.cmd to also register logon autostart.
exit /b 0
