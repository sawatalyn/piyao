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
rem  Protocol comes from the same file: scheme=http (default) or scheme=https plus
rem  tls_from=node|nginx and tls_pfx=<path>. Only "https + node + a pfx that exists"
rem  makes node listen with TLS; if the operator asked for HTTPS and the certificate
rem  is not there, this script REFUSES to start rather than come up in plaintext -
rem  a site that looks encrypted and is not is the worst possible outcome.
rem  https + nginx means the backend keeps listening plaintext on loopback and
rem  Nginx terminates TLS in front of it.
rem
rem  Note on paths: the three keys read here are plain ASCII, so the OEM codepage
rem  cmd reads with is not a problem. A certificate path containing CJK characters
rem  would be - the dashboard warns about that when it writes the value.
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
set "SCHEME=http"
set "TLS_FROM=node"
set "TLS_PFX="
set "CFG=%LocalAppData%\Bianwang\dashboard.cfg"
if exist "%~dp0port.txt" set /p PORT=<"%~dp0port.txt"
if exist "%CFG%" (
  for /f "usebackq tokens=1,* delims==" %%k in ("%CFG%") do (
    if /i "%%k"=="port" if not defined PORT set "PORT=%%l"
    if /i "%%k"=="scheme" set "SCHEME=%%l"
    if /i "%%k"=="tls_from" set "TLS_FROM=%%l"
    if /i "%%k"=="tls_pfx" set "TLS_PFX=%%l"
  )
)
if /i not "!SCHEME!"=="https" set "SCHEME=http"

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
rem Which Node runs the site is decided by runtime.cmd, and only there: the
rem offline package carries its own (Electron's executable in node mode, so this
rem task works on a machine where Node.js was never installed and where the
rem SYSTEM account has no PATH to speak of), the plain zip falls back to node on
rem PATH. Refusing is the shared failure mode either way.
call "%~dp0runtime.cmd"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  if "%RC%"=="3" echo [%date% %time%] [X] the node on PATH is too old to run this build.
  if not "%RC%"=="3" echo [%date% %time%] [X] no runtime: no runtime\BianwangRuntime.exe and no node on PATH.
  echo [%date% %time%]     Run installer\env.cmd, or use the offline package, which brings its own.
  exit /b 3
)
echo [%date% %time%] runtime: %BW_RUNTIME_KIND% %BW_RUNTIME_VER%

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

rem ---- protocol, decided from the same file the dashboard wrote ----
if /i not "!SCHEME!"=="https" goto plain
if /i not "!TLS_FROM!"=="node" (
  echo [%date% %time%] https is served by Nginx in front; node keeps listening plaintext on loopback.
  echo [%date% %time%] launching %BW_RUNTIME_KIND% api\src\index.js  ^(http://127.0.0.1:!PORT! via nginx TLS^)
  "%BW_NODE%" "%ROOT%\api\src\index.js" >> "!LOG!" 2>&1
  goto exited
)
if not defined TLS_PFX (
  echo [%date% %time%] [X] scheme=https with tls_from=node but no tls_pfx is recorded.
  echo [%date% %time%]     Open the dashboard, pick HTTPS and generate or point at a certificate,
  echo [%date% %time%]     or switch to "front-end Nginx" / back to HTTP. Refusing to start.
  exit /b 4
)
if not exist "!TLS_PFX!" (
  echo [%date% %time%] [X] the certificate file is not there: !TLS_PFX!
  echo [%date% %time%]     Refusing to start - coming up in plaintext after you asked for HTTPS
  echo [%date% %time%]     would leave you believing the link is encrypted.
  exit /b 4
)
set "BW_TLS_PFX=!TLS_PFX!"
echo [%date% %time%] launching %BW_RUNTIME_KIND% api\src\index.js  ^(https://127.0.0.1:!PORT! with TLS^)
"%BW_NODE%" "%ROOT%\api\src\index.js" >> "!LOG!" 2>&1
goto exited

:plain
echo [%date% %time%] launching %BW_RUNTIME_KIND% api\src\index.js  ^(http://127.0.0.1:!PORT!, plaintext^)
"%BW_NODE%" "%ROOT%\api\src\index.js" >> "!LOG!" 2>&1

:exited
echo [%date% %time%] node exited with %ERRORLEVEL% >> "%LOG%"
exit /b 0
