@echo off
setlocal enabledelayedexpansion
set "SELF=%~dp0"
rem ============================================================================
rem  Bianwang - AUTOSTART  (register / remove the boot-time task, start the site)
rem
rem  Three real shapes, chosen by the caller (the installer GUI's tab 3, or you):
rem
rem    /site:boot     task BianwangSite   ONSTART, runs as SYSTEM
rem                   -> reachable before anyone logs in. Needs admin, and a
rem                      client SKU may still refuse the SYSTEM identity; that is
rem                      reported as rc 4 (degraded), never as success.
rem    /site:none     register nothing; just start the site now, detached.
rem                   Logon-time autostart is NOT this script's job: it is a HKCU
rem                   Run value, which the installer GUI (runtime\BianwangRuntime.exe)
rem                   writes itself,
rem                   because a plain user cannot create an ONLOGON task either
rem                   (measured: schtasks /create /sc onlogon -> access denied).
rem
rem    /dash:on|off   also register the dashboard's own logon task (boot mode only)
rem
rem  Usage:
rem      autostart.cmd                          ask for a port, boot mode, dash on
rem      autostart.cmd /port 8787 /site:boot    register the ONSTART task
rem      autostart.cmd /port 8787 /site:none    no task, start it now
rem      autostart.cmd /port 8787 /site:boot /dash:off
rem      autostart.cmd /remove                  delete both tasks
rem      autostart.cmd /status                  show what is registered
rem
rem  Exit codes:  0 done / 1 needs admin / 2 not deployed yet / 3 bad port
rem               4 boot task refused, site started anyway
rem
rem  NOTE: intentionally ASCII-only - cmd.exe reads .cmd in the OEM codepage.
rem ============================================================================

cd /d "%SELF%"

set "ROOT=%~dp0.."
for %%A in ("%ROOT%") do set "ROOT=%%~fA"
set "TASK_SITE=BianwangSite"
set "TASK_DASH=BianwangDashboard"
set "PORT_FILE=%~dp0port.txt"
set "RUNSITE=%SELF%run-site.cmd"
set "DASHEXE=%ROOT%\dashboard\BianwangDashboard.exe"

set "MODE=/register"
set "SITE_MODE=boot"
set "DASH_MODE=on"
set "PORT="
:args
if "%~1"=="" goto argsdone
if /i "%~1"=="/remove"      set "MODE=/remove"
if /i "%~1"=="/status"      set "MODE=/status"
if /i "%~1"=="/port"        ( set "PORT=%~2" & shift )
if /i "%~1"=="/site:boot"   set "SITE_MODE=boot"
if /i "%~1"=="/site:none"   set "SITE_MODE=none"
if /i "%~1"=="/dash:on"     set "DASH_MODE=on"
if /i "%~1"=="/dash:off"    set "DASH_MODE=off"
shift
goto args
:argsdone

rem Reading the registration is harmless and must work from an ordinary prompt,
rem so it goes before the elevation gate.
if /i "%MODE%"=="/status" goto status

rem The boot task is the only thing here that needs admin. /remove does touch a
rem SYSTEM task, so it keeps the gate; /site:none does not.
if /i "%SITE_MODE%"=="none" if /i "%MODE%"=="/register" goto noelevate
net session 1>nul 2>nul
if errorlevel 1 (
  if /i "%MODE%"=="/remove" goto needadmin
  if /i "%SITE_MODE%"=="boot" goto needadmin
)
:noelevate

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

if /i "%SITE_MODE%"=="none" goto recordonly

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

if /i "%DASH_MODE%"=="off" goto nodash
if not exist "%DASHEXE%" (
  echo.
  echo [-] %DASHEXE% is not there, so the dashboard task is skipped.
  echo     Build it once:   "%ROOT%\dashboard\build.cmd"
  goto nodash
)
echo.
echo [*] Registering %TASK_DASH% ^(at logon, as you^)...
schtasks /delete /tn "%TASK_DASH%" /f 1>nul 2>nul
schtasks /create /tn "%TASK_DASH%" /tr "\"%DASHEXE%\" --autostart" /sc onlogon /rl limited /f
if errorlevel 1 (
  echo [-] could not create the dashboard task.
) else (
  echo [ok] %TASK_DASH%
)
:nodash

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

:recordonly
rem /site:none means "register nothing" - the port is recorded above and starting
rem the site is left to the caller. Doing it here with "start /b" would tie the
rem site's lifetime to whoever is reading our output: measured, a detached child
rem keeps a redirected stdout pipe open, so any caller that waits for EOF hangs on
rem a site that is running perfectly. The installer GUI (runtime\BianwangRuntime.exe)
rem launches it in its own session instead.
echo.
echo [i] Nothing registered. The port is recorded; start the site with
echo     run-site.cmd, the dashboard, or the installer GUI (runtime\BianwangRuntime.exe).
goto done

:startdirect
rem The boot task was refused, but the operator should still see whether the
rem program itself runs. Detached, because run-site.cmd holds the console for
rem as long as node is up. This does NOT replace the boot task - it will not come
rem back on its own after a reboot.
echo [*] The boot task could not be registered, so the site is started directly
echo     instead. That proves the program runs, but it will NOT come back by
echo     itself after a reboot.
start "" /b "%RUNSITE%"

:probe
rem Give node a few seconds, then ask the port whether anything answers.
rem The verdict travels as an exit code, never through a file: PowerShell's own
rem ">" redirection writes UTF-16, and cmd then reads that back as garbage.
rem
rem The URL we print must be the one the site will actually answer on, so read the
rem protocol the dashboard recorded (scheme / tls_from). Only these three keys are
rem consumed here and all three are ASCII values - a certificate PATH is never read
rem by this script (run-site.cmd is the one that passes it to node).
set "SCHEME=http"
set "TLS_FROM=node"
if exist "%LocalAppData%\Bianwang\dashboard.cfg" (
  for /f "usebackq tokens=1,* delims==" %%k in ("%LocalAppData%\Bianwang\dashboard.cfg") do (
    if /i "%%k"=="scheme" set "SCHEME=%%l"
    if /i "%%k"=="tls_from" set "TLS_FROM=%%l"
  )
)
set "SITE_URL=http://127.0.0.1:%PORT%"
if /i not "!SCHEME!"=="https" goto probedone
if /i "!TLS_FROM!"=="nginx" (set "SITE_URL=https://127.0.0.1" & goto probedone)
set "SITE_URL=https://127.0.0.1:%PORT%"
:probedone
powershell -NoProfile -Command "Start-Sleep -Seconds 8; try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', %PORT%); exit 0 } catch { exit 1 }" 1>nul 2>nul
if errorlevel 1 (
  echo [-] nothing is listening on %PORT% yet.
  echo     Look at installer\run-site.log - it records what node said.
  echo     If the log says it refused to start because a certificate is missing,
  echo     that is by design: you asked for HTTPS and it will not come up in plaintext.
) else (
  echo [ok] site is up on !SITE_URL!
  echo      credential note: run installer\creds.cmd to open it
)

if defined SITE_FAILED exit /b 4
goto done

:needadmin
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
echo     And "logon autostart" does not need any of this: the installer GUI
echo     (runtime\BianwangRuntime.exe) writes the HKCU Run value instead, as your own account.
exit /b 1

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
