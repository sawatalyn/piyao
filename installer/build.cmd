@echo off
setlocal
rem ============================================================================
rem  Bianwang installer - build the GUI setup EXE with the C# compiler that
rem  ships with Windows (.NET Framework 4.x).
rem
rem  Output: installer\BianwangInstaller.exe
rem  Input : installer\Installer.cs
rem  Re-run after editing Installer.cs. setup.cmd calls this automatically,
rem  so a fresh machine only ever double-clicks setup.cmd.
rem
rem  Why compile here instead of shipping an exe: same rule as the dashboard
rem  (A-6/A-11) - a frozen binary carries whatever the source looked like at
rem  build time, and the last release taught us what that costs.
rem
rem  NOTE: intentionally ASCII-only - cmd.exe reads .cmd in the OEM codepage.
rem ============================================================================

cd /d "%~dp0"

set "CSC="
if exist "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not defined CSC if exist "%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

if not defined CSC (
  echo [X] No in-box C# compiler found under %WINDIR%\Microsoft.NET Framework*\v4.0.30319
  echo     The GUI installer cannot be built without it. Enable the component:
  echo       optionalfeatures.exe   ^(turn on ".NET Framework 4.8 / 4.x Advanced Services"^)
  echo     or get it from https://dotnet.microsoft.com/download/dotnet-framework
  echo.
  echo     The site itself does NOT need this. Without the GUI you still have the
  echo     scripted path, which does the same four steps in order:
  echo         setup.cmd /cli            or  env.cmd -^> deploy.cmd -^> autostart.cmd
  exit /b 2
)

if not exist "Installer.cs" (
  echo [X] Installer.cs is not next to this script.
  exit /b 2
)

rem csc cannot overwrite an exe that is in use, and the failure it reports
rem (CS0016) does not mention the running process at all.
rem findstr, not find: a PATH leading with Git-for-Windows shadows find.exe with GNU find.
tasklist /FI "IMAGENAME eq BianwangInstaller.exe" 2>nul | findstr /i /c:"BianwangInstaller.exe" >nul
if not errorlevel 1 (
  echo [X] BianwangInstaller.exe is running - close the installer window first.
  exit /b 3
)

echo [*] Using compiler: %CSC%

if exist "BianwangInstaller.exe" del /q "BianwangInstaller.exe" 2>nul

rem /codepage:65001 is required, not cosmetic: without it csc guesses the source
rem encoding from the machine ANSI codepage, and Installer.cs holds Chinese
rem string literals that would get baked into the UI text as mojibake.
"%CSC%" /nologo /target:winexe /optimize+ /codepage:65001 ^
  /out:BianwangInstaller.exe ^
  /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll ^
  Installer.cs
if errorlevel 1 (
  echo [X] compile failed - see the messages above.
  exit /b 1
)

if not exist "BianwangInstaller.exe" (
  echo [X] compiler reported success but produced no exe.
  exit /b 1
)

echo [OK] built installer\BianwangInstaller.exe
echo      Double-click it, or run it from a console for the scripted form:
echo          BianwangInstaller.exe --selfcheck --report check.txt
echo          BianwangInstaller.exe --install --target D:\Sites\bianwang --port 8787 --autostart logon
exit /b 0
