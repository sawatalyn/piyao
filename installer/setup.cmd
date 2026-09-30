@echo off
setlocal enabledelayedexpansion
set "SELF=%~dp0"
rem ============================================================================
rem  Bianwang - ONE-CLICK SETUP
rem
rem  The single entry point on a fresh Windows machine. It runs, in order:
rem
rem      1. env.cmd        check Node.js; install or update it through winget
rem      2. deploy.cmd     put the package where it will live, build the exe
rem      3. autostart.cmd  ask for a port, register boot-time site + logon GUI
rem      4. a live check   is the archive actually answering on that port
rem
rem  Every step is idempotent, so running this twice on an existing install just
rem  refreshes it: api\data is never overwritten, the tasks are recreated with the
rem  same names, the port you already gave is reused.
rem
rem  It stops the moment a step fails and tells you which one, rather than
rem  carrying on into a half-installed state.
rem
rem  Needs an elevated prompt for step 3 to succeed; it warns instead of failing
rem  if you are not elevated, because steps 1-2 still work without it.
rem
rem  Usage:
rem      setup.cmd                       full install to C:\Bianwang
rem      setup.cmd D:\Sites\bianwang     install somewhere else
rem      setup.cmd /check                only step 1
rem      setup.cmd /skipenv              steps 2-4, leave the runtime alone
rem ============================================================================

cd /d "%SELF%"

set "TARGET=C:\Bianwang"
set "ONLY_CHECK=0"
set "SKIP_ENV=0"
set "PORT="
:args
if "%~1"=="" goto argsdone
if /i "%~1"=="/check"    set "ONLY_CHECK=1"
if /i "%~1"=="/skipenv"  set "SKIP_ENV=1"
if /i "%~1"=="/port" ( set "PORT=%~2" & shift )
if /i "%~1"=="/target" ( set "TARGET=%~2" & shift )
shift
goto args
:argsdone

echo ============================================================
echo  Bianwang one-click setup
echo  package : %SELF%..
echo  target  : %TARGET%
echo ============================================================
echo.

net session 1>nul 2>nul
if errorlevel 1 (
  echo [-] Not elevated. Steps 1 and 2 will work; step 3 cannot create the
  echo     boot-time task as SYSTEM. Re-run this from an elevated prompt if you
  echo     want the site to come up before anyone logs in.
  echo.
)

rem ---------------------------------------------------------------- 1. env --
if /i "%SKIP_ENV%"=="0" (
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
)

if /i "%ONLY_CHECK%"=="1" (
  echo ============================================================
  echo  Check only, as requested. Nothing was installed or copied.
  echo ============================================================
  pause
  exit /b 0
)

rem -------------------------------------------------------------- 2. deploy --
echo ------------------------------------------------------------
echo  [2/4] deploying the program
echo ------------------------------------------------------------
call deploy.cmd "%TARGET%" <nul
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo [X] deploy failed with code !RC! - stopping before anything is registered.
  pause
  exit /b 20
)
echo.

rem ------------------------------------------------------------- 3. autostart --
echo ------------------------------------------------------------
echo  [3/4] autostart and first start
echo ------------------------------------------------------------
if not defined PORT (
  if exist "%SELF%port.txt" set /p PORT=<"%SELF%port.txt"
)
if not defined PORT (
  set /p "PORT=    port the site should listen on (e.g. 8787): "
)
call autostart.cmd /port %PORT%
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo [-] autostart did not finish cleanly - the program is deployed and the site
  echo     works, but the boot task may not be registered. See the lines above;
  echo     the fix is usually to re-run this from an elevated prompt:
  echo         cd /d "%SELF%" ^&^& setup.cmd
  echo     You can still start the site by hand: %TARGET%\dashboard\BianwangDashboard.exe
  pause
  exit /b 30
)
echo.

rem ---------------------------------------------------------------- 4. check --
echo ------------------------------------------------------------
echo  [4/4] live check
echo ------------------------------------------------------------
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:%PORT%/api/menu') -Headers @{ 'User-Agent'='Mozilla/5.0 (setup-check)' } -TimeoutSec 10; Write-Output ('[ok] backend answered /api/menu with ' + $r.StatusCode) } catch { Write-Output ('[X] backend not answering: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
  echo [-] The site did not answer. Read %TARGET%\installer\run-site.log
  pause
  exit /b 40
)

echo.
echo ============================================================
echo  Installed and running.
echo.
echo    open the archive     http://127.0.0.1:%PORT%
echo    sign in              admin  /  the password printed in
echo                         %TARGET%\installer\creds.cmd
echo    the dashboard        %TARGET%\dashboard\BianwangDashboard.exe
echo    at boot              the site comes up on its own ^(BianwangSite^)
echo                         and the dashboard follows your logon
echo    to take it all out   %TARGET%\installer\uninstall.cmd
echo.
echo  The credential note is plaintext and lives outside the package - treat it as a
echo  credential. Change the admin password from the site the first time in.
echo ============================================================
pause
exit /b 0
