@echo off
setlocal
rem ============================================================================
rem  Bianwang dashboard - INSTALL (Windows, per-user, no admin rights needed).
rem
rem  What it does:
rem    1. checks the build toolchain (in-box C# compiler) and Node.js, and tells
rem       you what is missing instead of silently failing;
rem    2. builds dashboard\BianwangDashboard.exe (source is in the repo, the exe
rem       is produced here - nothing binary is trusted from the zip);
rem    3. registers LOGON autostart in HKCU\...\Run pointing at
rem       BianwangDashboard.exe --autostart, i.e. at boot the dashboard comes up
rem       and brings the site with it on the port you last confirmed.
rem       The first ever boot has no remembered port, so it will NOT guess one:
rem       it just opens the window and waits for you to fill it in.
rem    4. drops a Start Menu shortcut.
rem
rem  Undo all of it with uninstall.cmd.
rem  NOTE: intentionally ASCII-only - cmd.exe reads .cmd in the OEM codepage.
rem ============================================================================

cd /d "%~dp0"

echo ============================================================
echo  Bianwang dashboard installer (per-user, no elevation)
echo ============================================================
echo.

set "CSC="
if exist "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not defined CSC if exist "%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if defined CSC (
  echo [ok] C# compiler        : %CSC%
) else (
  echo [MISSING] .NET Framework 4.x C# compiler is not present under %WINDIR%\Microsoft.NET\Framework*\v4.0.30319
  echo           The dashboard exe cannot be built without it. Enable it:
  echo             optionalfeatures.exe  -^>  ".NET Framework 4.8" / "4.x Advanced Services"
  echo           or get the runtime installer from
  echo             https://dotnet.microsoft.com/download/dotnet-framework
  echo           The website itself does NOT need it - only this dashboard does.
  echo.
  echo           Nothing was installed and nothing was registered.
  pause
  exit /b 2
)

echo.
node -v 1>nul 2>nul
if errorlevel 1 (
  echo [MISSING] Node.js is not on PATH. The site backend needs it ^(>= 20.19.0^).
  echo           Download and install it from  https://nodejs.org/zh-cn/download
  echo           then start the dashboard anyway - it will show you this in its
  echo           own environment panel and link you to the same page.
) else (
  for /f "delims=" %%v in ('node -v') do echo [ok] Node.js              : %%v
)

echo.
echo [*] Building the dashboard exe...
call build.cmd
if errorlevel 1 (
  echo [X] build failed, see build.cmd output above. Nothing was registered.
  pause
  exit /b 1
)

set "EXE=%CD%\BianwangDashboard.exe"
if not exist "%EXE%" (
  echo [X] expected %EXE% but it is not there.
  pause
  exit /b 1
)

echo.
echo [*] Registering logon autostart (current user only)...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v BianwangDashboard /t REG_SZ /d "\"%EXE%\" --autostart" /f 1>nul
if errorlevel 1 (
  echo [X] Could not write the Run key. You can still start the exe by hand.
) else (
  echo [ok] Autostart registered: at logon the dashboard starts and brings the
  echo      site up on the last port you confirmed ^(none on the very first boot^).
)

rem Start Menu shortcut so it is findable without remembering the path.
rem Per-user Programs folder - the common one would need admin rights.
powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $dir=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; $s=$ws.CreateShortcut((Join-Path $dir 'Bianwang Dashboard.lnk')); $s.TargetPath='%EXE%'; $s.WorkingDirectory='%~dp0'; $s.Description='Bianwang rumor-debunk archive launcher'; $s.Save()" 1>nul 2>nul
if errorlevel 1 (
  echo [!] Start Menu shortcut skipped ^(harmless^).
) else (
  echo [ok] Start Menu shortcut: "Bianwang Dashboard"
)

echo.
echo ============================================================
echo  Done.
echo    Start now      :  double-click BianwangDashboard.exe
echo    Change port    :  type it in the window and hit start
echo    Turn autostart :  the checkbox inside the window, or run uninstall.cmd
echo    Site docs      :  docs\USAGE.md  /  docs\DEPLOY.md
echo ============================================================
pause
exit /b 0
