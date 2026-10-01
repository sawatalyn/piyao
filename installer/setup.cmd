@echo off
setlocal enabledelayedexpansion
set "SELF=%~dp0"
rem ============================================================================
rem  Bianwang - ONE-CLICK SETUP  (bootstrap)
rem
rem  Double-click this. Two shapes, same four steps underneath:
rem
rem    (default)  starts the graphical installer that ships inside the offline
rem               package - runtime\BianwangRuntime.exe, which is Electron's
rem               executable renamed. With ELECTRON_RUN_AS_NODE it is the Node
rem               the site runs on; launched plainly it is the installer window:
rem               self-check / install / autostart choice / maintenance. It calls
rem               the same .cmd engines below, so the logic stays in one place.
rem    /cli       the linear console form. Needs no exe at all, which is what you
rem               want over SSH, on a machine with no keyboard, or on Server Core
rem               (no GUI subsystem, so Electron cannot run there at all).
rem
rem  Escape hatches, all still supported:
rem      setup.cmd /cli [D:\Sites\bianwang]   scripted install
rem      setup.cmd /check                     environment check only
rem  Nothing here builds a binary any more: the previous form compiled
rem  Installer.cs with the in-box csc, and that step is gone with the Electron
rem  installer (see docs\DEVELOPMENT.md A-27 for why).
rem ============================================================================

cd /d "%SELF%"
set "ROOT=%SELF%.."
for %%A in ("%ROOT%") do set "ROOT=%%~fA"

set "TARGET="
set "PORT="
set "CLI=0"
set "ONLY_CHECK=0"
set "ARGS="
set "FIRST=%~1"

:args
if "%~1"=="" goto argsdone
if /i "%~1"=="/cli"      set "CLI=1"
if /i "%~1"=="/check"    set "ONLY_CHECK=1"
if /i "%~1"=="/port"     ( set "PORT=%~2" & shift )
if /i "%~1"=="/target"   ( set "TARGET=%~2" & shift )
shift
goto args
:argsdone

rem a bare directory as the first argument still means /target, like the old
rem setup.cmd did; a switch starts with a slash, so the two cannot be confused
if defined TARGET goto targetdone
if not defined FIRST goto targetdone
if /i "%FIRST:~0,1%"=="/" goto targetdone
set "TARGET=%FIRST%"
:targetdone

if /i "%ONLY_CHECK%"=="1" (
  echo ============================================================
  echo  Environment check only - nothing is built, copied or registered.
  echo ============================================================
  call env.cmd
  set "RC=!ERRORLEVEL!"
  if not "!RC!"=="0" echo [-] env.cmd exited with !RC! ^(2 = Node.js missing or too old^)
  pause
  exit /b !RC!
)

if /i "%CLI%"=="1" goto cli

rem ------------------------------------------------------------------ 1. GUI --
rem The graphical installer is the Electron app that ships INSIDE the offline
rem package: runtime\BianwangRuntime.exe is Electron's own executable, renamed.
rem Launched with ELECTRON_RUN_AS_NODE it is the Node the site runs on; launched
rem plainly it is the four-tab installer (self-check / install / autostart /
rem maintenance). One copy, two jobs - which is why the offline package needs no
rem separate installer binary and no in-box C# compiler at all.
set "APP=%ROOT%\runtime\BianwangRuntime.exe"

if not exist "%APP%" (
  echo [X] There is no runtime\BianwangRuntime.exe next to this script, so this
  echo     tree has no graphical installer. That file only comes with the offline
  echo     installer package ^(bianwang- VERSION -offline-win.exe^).
  echo     From here you can still:
  echo         setup.cmd /cli [D:\Sites\bianwang]   scripted form, needs no exe
  echo         setup.cmd /check                     environment check only
  pause
  exit /b 1
)

rem ---------------------------------------------------------------- 2. launch --
set "ARGS="
if defined TARGET set "ARGS=--target "%TARGET%""
if defined PORT   set "ARGS=!ARGS! --port %PORT%"
"%APP%" !ARGS!
set "RC=!ERRORLEVEL!"
echo.
echo [i] installer window closed (exit !RC!). Re-run setup.cmd any time - the
echo     program keeps its data, so a second run is an update, not a reinstall.
echo     Scripted form if you ever need it:  setup.cmd /cli
pause
exit /b !RC!

rem ================================================================ CLI path ===
:cli
rem The offline package is unpacked straight into where it will run, so the
rem scripted form defaults to the same place the GUI does. C:\Bianwang is only
rem the fallback for a tree that has no site next to it yet.
if not defined TARGET if exist "%SELF%..\api\src\index.js" set "TARGET=%SELF%.."
if not defined TARGET set "TARGET=C:\Bianwang"
for %%A in ("%TARGET%") do set "TARGET=%%~fA"
set "DEPLOY_ARGS="%TARGET%""
if /i not "%TARGET%"=="%ROOT%" goto cli_notinplace
set "DEPLOY_ARGS=!DEPLOY_ARGS! /inplace"
:cli_notinplace

echo ============================================================
echo  Bianwang one-click setup  (scripted form)
echo  package : %SELF%..
echo  target  : %TARGET%
echo ============================================================
echo.

net session 1>nul 2>nul
if errorlevel 1 (
  echo [-] Not elevated. Steps 1 and 2 will work; step 3 cannot create the
  echo     boot-time task as SYSTEM. Re-run from an elevated prompt, or pick
  echo     "logon autostart" in the GUI, which needs no elevation at all.
  echo.
)

rem ---------------------------------------------------------------- 1. env ----
echo ------------------------------------------------------------
echo  [1/4] runtime environment
echo ------------------------------------------------------------
call env.cmd
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  if "!RC!"=="2" (
    echo.
    set /p "FIX=Node.js is missing or too old. Install or update it with winget now? [Y/n]: "
    if /i not "!FIX!"=="n" (
      call env.cmd /install
      if errorlevel 1 (
        echo [X] the runtime is still not usable. Follow the guidance above,
        echo     then run setup.cmd again.
        pause
        exit /b 10
      )
    ) else (
      echo [X] You chose not to install it, and the site cannot run without Node.js.
      pause
      exit /b 11
    )
  ) else (
    echo [X] environment step failed with code !RC!
    pause
    exit /b 12
  )
)
echo.

rem ------------------------------------------------------------- 2. deploy ----
echo ------------------------------------------------------------
echo  [2/4] deploying the program
echo ------------------------------------------------------------
call deploy.cmd !DEPLOY_ARGS! <nul
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo [X] deploy failed with code !RC! - stopping before anything is registered.
  pause
  exit /b 20
)
echo.

rem ----------------------------------------------------------- 3. autostart ----
echo ------------------------------------------------------------
echo  [3/4] autostart and first start
echo ------------------------------------------------------------
if not defined PORT (
  if exist "%SELF%port.txt" set /p PORT=<"%SELF%port.txt"
)
if not defined PORT (
  set /p "PORT=    port the site should listen on (e.g. 8787): "
)
call autostart.cmd /port !PORT! /site:boot /dash:on
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  if "!RC!"=="4" (
    echo [-] the boot task was refused by policy, so the site was started for this
    echo     session instead and logon autostart is the fallback. It will not come
    echo     up before someone logs in. Details in docs\DEPLOY.md.
  ) else (
    echo [-] autostart did not finish cleanly - the program is deployed and the site
    echo     works, but the boot task may not be registered. See the lines above;
    echo     the fix is usually to re-run this from an elevated prompt:
    echo         cd /d "%SELF%" ^&^& setup.cmd /cli
    pause
    exit /b 30
  )
)
echo.

rem ---------------------------------------------------------------- 4. check ----
echo ------------------------------------------------------------
echo  [4/4] live check
echo ------------------------------------------------------------
rem Ask the port the question in the protocol the dashboard recorded (default http;
rem HTTPS is chosen in the dashboard, this script only follows it). The certificate
rem callback is set because a self-signed cert on loopback is exactly what "HTTPS +
rem backend" produces here; the URL below is always 127.0.0.1, never somebody else's host.
set "SCHEME=http"
set "TLS_FROM=node"
if exist "%LocalAppData%\Bianwang\dashboard.cfg" (
  for /f "usebackq tokens=1,* delims==" %%k in ("%LocalAppData%\Bianwang\dashboard.cfg") do (
    if /i "%%k"=="scheme" set "SCHEME=%%l"
    if /i "%%k"=="tls_from" set "TLS_FROM=%%l"
  )
)
set "SITE_URL=http://127.0.0.1:%PORT%"
if /i not "!SCHEME!"=="https" goto cli_url_done
if /i "!TLS_FROM!"=="nginx" (set "SITE_URL=https://127.0.0.1" & goto cli_url_done)
set "SITE_URL=https://127.0.0.1:%PORT%"
:cli_url_done
powershell -NoProfile -Command "[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { $r=Invoke-WebRequest -UseBasicParsing -Uri ('%SITE_URL%/api/menu') -Headers @{ 'User-Agent'='Mozilla/5.0 (setup-check)' } -TimeoutSec 10; Write-Output ('[ok] backend answered /api/menu over %SITE_URL% with ' + $r.StatusCode) } catch { Write-Output ('[X] backend not answering: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
  echo [-] The site did not answer. Read %TARGET%\installer\run-site.log
  echo     If it says it refused to start because a certificate is missing, open the
  echo     dashboard and either generate one or switch back to HTTP - that refusal is
  echo     deliberate: it will not come up in plaintext after you asked for HTTPS.
  pause
  exit /b 40
)

echo.
echo ============================================================
echo  Installed and running.
echo.
echo    open the archive     %SITE_URL%
echo    sign in              admin  /  the password in the credential note
echo    the credential note  run installer\creds.cmd to open it
echo    the dashboard        %TARGET%\dashboard\BianwangDashboard.exe
echo    to take it all out   %TARGET%\installer\uninstall.cmd
echo.
echo  The credential note is plaintext and lives outside the package - treat it as a
echo  credential. Change the admin password from the site the first time in.
echo ============================================================
pause
exit /b 0
