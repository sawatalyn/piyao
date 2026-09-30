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

if exist "BianwangDashboard.exe" del /q "BianwangDashboard.exe" 2>nul

"%CSC%" /nologo /target:winexe /optimize+ ^
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
