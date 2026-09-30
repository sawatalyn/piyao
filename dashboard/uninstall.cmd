@echo off
setlocal
rem ============================================================================
rem  Bianwang dashboard - UNINSTALL.
rem  Removes ONLY what install.cmd added: the HKCU logon-autostart Run value and
rem  the Start Menu shortcut. It does not touch your data, your passwords, the
rem  site files, or Node.js. Safe to run on a machine that never installed it.
rem  NOTE: intentionally ASCII-only - cmd.exe reads .cmd in the OEM codepage.
rem ============================================================================

cd /d "%~dp0"

echo [*] Removing logon autostart entry (current user)...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v BianwangDashboard /f 1>nul 2>nul
if errorlevel 1 (
  echo     nothing registered under that name - fine.
) else (
  echo     [ok] autostart removed.
)

echo [*] Removing Start Menu shortcut...
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Bianwang Dashboard.lnk" (
  del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Bianwang Dashboard.lnk" 1>nul 2>nul
  echo     [ok] shortcut removed.
) else (
  echo     no shortcut to remove.
)

echo.
echo Remaining on disk (delete by hand only if you want them gone):
echo   %CD%\BianwangDashboard.exe
echo   %LOCALAPPDATA%\Bianwang\dashboard.cfg   (remembers the last port)
echo.
echo Your archive data and the plain-password user file are NOT touched by this
echo script. If you want them reviewed first, open  口令.txt  in the site root.
pause
exit /b 0
