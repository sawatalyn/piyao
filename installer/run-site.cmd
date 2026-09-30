@echo off
setlocal enabledelayedexpansion
rem ============================================================================
rem  Bianwang - RUN SITE  (the command the boot-time scheduled task executes)
rem
rem  This is the piece that lets the backend start before anybody logs in:
rem  a scheduled task has no console and no environment, so everything it needs
rem  has to be decided now and written down.
rem
rem  Port resolution, in order:
rem    1. port.txt next to this script  (written by autostart.cmd when it asks)
rem    2. the dashboard's own remembered port  (%LOCALAPPDATA%\Bianwang\dashboard.cfg)
rem    3. nothing - refuse, and say so in the log
rem  Step 3 is deliberate. Guessing a default port silently would move the site
rem  to a port nobody told it to use, which is worse than not starting.
rem
rem  Called by: the BianwangSite scheduled task, or you, by hand.
rem ============================================================================

cd /d "%~dp0"
set "ROOT=%~dp0.."
for %%A in ("%ROOT%") do set "ROOT=%%~fA"
set "LOG=%~dp0run-site.log"

if not exist "%ROOT%\api\src\index.js" (
  echo [X] no api\src\index.js under %ROOT% 1>&2
  echo [%date% %time%] [X] no api\src\index.js under %ROOT% >> "%LOG%"
  exit /b 1
)

set "PORT="
if exist "%~dp0port.txt" set /p PORT=<"%~dp0port.txt"
if not defined PORT (
  if exist "%LocalAppData%\Bianwang\dashboard.cfg" (
    for /f "usebackq tokens=1,* delims==" %%k in ("%LocalAppData%\Bianwang\dashboard.cfg") do (
      if /i "%%k"=="port" set "PORT=%%l"
    )
  )
)

if not defined PORT (
  echo [%date% %time%] [X] no port to bind: %~dp0port.txt is missing and no port is remembered.
  echo [%date% %time%]     Run autostart.cmd and give it one, then this task will start the site.
  echo [X] No port configured for autostart. Run autostart.cmd first. 1>&2
  exit /b 2
)

rem strip anything that is not a digit (a trailing CR or a stray space is enough
rem to make node bind a port name nobody asked for)
for /f "delims=0123456789" %%x in ("!PORT!") do set "PORT_JUNK=%%x"
if defined PORT_JUNK set "PORT=!PORT:%PORT_JUNK%=!"

echo [%date% %time%] starting on port !PORT!
where node 1>nul 2>nul
if errorlevel 1 (
  echo [%date% %time%] [X] node is not on PATH for this account. Install it, or make the
  echo [%date% %time%]     task run as a user that has it.
  exit /b 3
)

rem A boot task must not leave an orphan from the previous boot holding the port.
rem If something already answers on it we log and exit clean - that is a success,
rem not a failure, and the next check will show the site as up.
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; $r=$c.BeginConnect('127.0.0.1',!PORT!,$null,$null); if ($r.AsyncWaitHandle.WaitOne(600)) { $c.Close(); exit 10 } else { exit 11 }" 1>nul 2>nul
set "PROBE=%ERRORLEVEL%"
if "%PROBE%"=="10" (
  echo [%date% %time%] port !PORT! is already serving - nothing to do.
  exit /b 0
)

set "NODE_ENV=production"
set "BW_PORT=!PORT!"
echo [%date% %time%] launching node api\src\index.js
node "%ROOT%\api\src\index.js" >> "%LOG%" 2>&1
echo [%date% %time%] node exited with %ERRORLEVEL% >> "%LOG%"
exit /b 0
