@echo off
setlocal enabledelayedexpansion
set "SELF=%~dp0"
rem ============================================================================
rem  Bianwang - AUTOSTART  (register / remove the two scheduled tasks)
rem
rem  Two carriers, because they answer two different questions:
rem
rem    BianwangSite        trigger ONSTART, runs as SYSTEM
rem                        -> the archive is reachable the moment the machine is
rem                           up, before anyone logs in. This is what you deploy
rem                           on a Windows Server box that serves the intranet.
rem
rem    BianwangDashboard   trigger ONLOGON, runs as the interacting user
rem                        -> the GUI comes back with the session so you can
rem                           see status, read the log and change the port.
rem                           It does NOT start a second backend: the dashboard
rem                           checks whether the port is already serving and
rem                           stands down if it is.
rem
rem  Requires administrator rights (schtasks /sc ONSTART with /ru SYSTEM does).
rem  Re-run any number of times: /f recreates the same task names.
rem
rem  Usage:
rem      autostart.cmd                 ask for a port, register both
rem      autostart.cmd /port 8787      register both with an explicit port
rem      autostart.cmd /remove         delete both tasks
rem      autostart.cmd /status         show what is registered
rem ============================================================================

cd /d "%SELF%"

set "ROOT=%~dp0.."
for %%A in ("%ROOT%") do set "ROOT=%%~fA"
set "TASK_SITE=BianwangSite"
set "TASK_DASH=BianwangDashboard"
set "PORT_FILE=%~dp0port.txt"

set "MODE=/register"
set "PORT="
:args
if "%~1"=="" goto argsdone
if /i "%~1"=="/remove"   set "MODE=/remove"
if /i "%~1"=="/status"   set "MODE=/status"
if /i "%~1"=="/port" ( set "PORT=%~2" & shift )
shift
goto args
:argsdone

rem Reading the registration is harmless and should work from an ordinary prompt,
rem so it goes before the elevation gate.
if /i "%MODE%"=="/status" goto status

rem ---- admin rights: ONSTART + /ru SYSTEM cannot be created without them ----
net session 1>nul 2>nul
if errorlevel 1 (
  echo [X] This needs an elevated prompt - creating a boot-time task that runs as
  echo     SYSTEM is an administrator action. Windows does not let a standard
  echo     session do it, and the task scheduler will not tell you why it failed.
  echo.
  echo     Open one with:   start as Administrator   on cmd, then
  echo         cd /d "%SELF%"
  echo         autostart.cmd
  echo.
  echo     You can still see what is registered without elevating:
  echo         autostart.cmd /status
  exit /b 1
)

if /i "%MODE%"=="/remove" goto remove

rem ---------------------------------------------------------------- register --
if not exist "%ROOT%\api\src\index.js" (
  echo [X] no deployed site under %ROOT% - run deploy.cmd first.
  exit /b 2
)

if defined PORT goto portknown
if not exist "%PORT_FILE%" goto portask
set /p PORT=<"%PORT_FILE%"
if defined PORT goto portknown

:portask
echo No port has been recorded for autostart yet, and the dashboard has never
echo been run on this account, so there is nothing to remember either.
echo.
set /p "PORT=    port for the site to bind at boot: "

:portknown
rem A label cannot live inside a parenthesised block, and a findstr range
rem pattern cannot express 1-65535, so validate in two steps: digits only,
rem then the actual bounds.
set "PORT_BAD="
if not defined PORT set "PORT_BAD=empty"
if not defined PORT_BAD for /f "delims=0123456789" %%x in ("!PORT!") do set "PORT_BAD=not-digits"
if not defined PORT_BAD if !PORT! LSS 1 set "PORT_BAD=out-of-range"
if not defined PORT_BAD if !PORT! GTR 65535 set "PORT_BAD=out-of-range"
if defined PORT_BAD (
  echo [X] "%PORT%" is not a usable port number ^(1-65535, digits only, reason: !PORT_BAD!^).
  echo     Nothing was registered.
  exit /b 3
)

> "%PORT_FILE%" echo %PORT%
echo [ok] port recorded in installer\port.txt : %PORT%

set "RUNSITE=%SELF%run-site.cmd"
set "DASHEXE=%ROOT%\dashboard\BianwangDashboard.exe"

echo.
echo [*] Registering %TASK_SITE% (at boot, as SYSTEM, hidden)...
schtasks /end /tn "%TASK_SITE%" 1>nul 2>nul
schtasks /delete /tn "%TASK_SITE%" /f 1>nul 2>nul
schtasks /create /tn "%TASK_SITE%" /tr "\"%RUNSITE%\"" /sc onstart /ru SYSTEM /rl highest /f
set "RC=!ERRORLEVEL!"
set "SITE_FAILED="
if not "!RC!"=="0" set "SITE_FAILED=1"
if defined SITE_FAILED (
  echo [X] could not create the boot task ^(schtasks exited with !RC!^).
  echo     If the line above is "access denied" even from an elevated prompt, this
  echo     machine does not let a scheduled task take the SYSTEM identity - client
  echo     SKUs with a restrictive "Log on as a batch job" / "Log on as a service"
  echo     policy do that, and the task scheduler will not say which.
  echo     Continuing: the logon task below is still worth registering, and the
  echo     site can always be started by hand with run-site.cmd.
) else (
  echo [ok] %TASK_SITE%
)

if not exist "%DASHEXE%" (
  echo.
  echo [-] %DASHEXE% is not there, so the dashboard task is skipped.
  echo     Build it once:   "%ROOT%\dashboard\build.cmd"
) else (
  echo.
  echo [*] Registering %TASK_DASH% ^(at logon, as you^)...
  schtasks /delete /tn "%TASK_DASH%" /f 1>nul 2>nul
  schtasks /create /tn "%TASK_DASH%" /tr "\"%DASHEXE%\" --autostart" /sc onlogon /rl limited /f
  if errorlevel 1 (
    echo [-] could not create the dashboard task.
  ) else (
    echo [ok] %TASK_DASH%
  )
)

echo.
if defined SITE_FAILED goto startdirect
echo [*] Starting the site now, through the task itself, so you do not have to
echo     reboot to find out whether the boot path works...
rem Calling run-site.cmd directly would hang this console: node runs in the
rem foreground for as long as the site is up. Let the scheduler own it.
schtasks /run /tn "%TASK_SITE%" 1>nul 2>nul
if errorlevel 1 (
  echo [-] could not start the task on demand. It is registered; it will come up
  echo     at the next boot. To see it now:   schtasks /run /tn %TASK_SITE%
)
goto probe

:startdirect
rem The boot task was refused, but the operator should still see whether the
rem program itself runs. Detached, because run-site.cmd holds the console for
rem as long as node is up. This does NOT replace the boot task - it will not come
rem back on its own after a reboot.
echo [*] The boot task could not be registered, so the site is started directly
echo     instead. That proves the program runs, but it will NOT come back by
echo     itself after a reboot.
start "" /b "%RUNSITE%"
goto probe

:probe
rem Give node a few seconds, then ask the port whether anything answers.
rem The verdict travels as an exit code, never through a file: PowerShell's own
rem ">" redirection writes UTF-16, and cmd then reads that back as garbage.
powershell -NoProfile -Command "Start-Sleep -Seconds 8; try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', %PORT%); exit 0 } catch { exit 1 }" 1>nul 2>nul
if errorlevel 1 (
  echo [-] nothing is listening on %PORT% yet.
  echo     Look at installer\run-site.log - it records what node said.
) else (
  echo [ok] site is up on http://127.0.0.1:%PORT%
  echo      credential note: run installer\creds.cmd to open it
)

if defined SITE_FAILED exit /b 4
goto done

:remove
echo [*] Removing scheduled tasks...
schtasks /end /tn "%TASK_SITE%" 1>nul 2>nul
schtasks /delete /tn "%TASK_SITE%" /f 1>nul 2>nul
if errorlevel 1 (echo [ ] %TASK_SITE% was not registered^) else (echo [ok] %TASK_SITE% removed)
schtasks /end /tn "%TASK_DASH%" 1>nul 2>nul
schtasks /delete /tn "%TASK_DASH%" /f 1>nul 2>nul
if errorlevel 1 (echo [ ] %TASK_DASH% was not registered^) else (echo [ok] %TASK_DASH% removed)
echo.
echo The program files were left alone - use uninstall.cmd for that.
goto done

:status
echo ============================================================
echo  Bianwang autostart status
echo ============================================================
schtasks /query /tn "%TASK_SITE%" /fo LIST 2>nul
if errorlevel 1 echo [ ] %TASK_SITE%  : not registered
schtasks /query /tn "%TASK_DASH%" /fo LIST 2>nul
if errorlevel 1 echo [ ] %TASK_DASH%  : not registered
if exist "%PORT_FILE%" (
  set /p CUR=<"%PORT_FILE%"
  echo [i] recorded boot port : !CUR!
) else (
  echo [i] recorded boot port : none
)
goto done

:done
endlocal
exit /b 0
