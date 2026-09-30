@echo off
setlocal enabledelayedexpansion
rem ============================================================================
rem  Bianwang - UNINSTALL
rem
rem  Removes, in order:
rem    1. the running backend (the process that holds the port)
rem    2. the two scheduled tasks from autostart.cmd
rem    3. the logon Run value and the Start Menu shortcut from dashboard\install.cmd
rem    4. the whole program directory - INCLUDING api\data
rem
rem  Step 4 is destructive by design: this deployment carries the archives, the
rem  uploaded pictures, the library files and the plaintext password CSV, and
rem  asking for a full uninstall means you want all of it gone. There is no undo
rem  and no recycle bin, so it stops and asks for the word DELETE. It offers a
rem  copy of api\data first; that copy is only ever made, never deleted.
rem
rem  WHY THIS SCRIPT RE-RUNS ITSELF
rem  ------------------------------
rem  cmd.exe reads a batch file lazily, one line at a time, straight off the disk.
rem  This script normally sits in <site>\installer, i.e. inside the very tree it
rem  is about to delete. Measured on this machine: the folder really did go away,
rem  and every line after the rd was replaced by "The system cannot find the path
rem  specified" - so a clean uninstall printed two errors and returned exit code
rem  1. Chaining the rest onto one line with "&" does not help either; cmd still
rem  goes back for the next command.
rem
rem  So everything below the launcher is run by a copy in %TEMP% - outside the
rem  tree - which can delete the tree and still read itself afterwards. The
rem  launcher starts that copy and exits on the same line, which was the one
rem  arrangement that tested clean (rc 0, no stray message). The copy opens in
rem  its own window: that is the window you answer the questions in and read the
rem  report in, so leave it up until it says it is done.
rem
rem  Usage:
rem      uninstall.cmd                 interactive
rem      uninstall.cmd /quiet          stop + unregister, keep the files
rem      uninstall.cmd /data D:\bak    put a pre-deletion copy of api\data there
rem ============================================================================

if /i "%~1"=="/worker" goto worker

rem ----------------------------------------------------------------- launcher --
set "SITE_ROOT=%~dp0.."
for %%A in ("%SITE_ROOT%") do set "SITE_ROOT=%%~fA"

rem /quiet never deletes the tree, so there is no reason to hop into a copy in
rem %TEMP%: running inline keeps the caller waiting for the real result and gives
rem a meaningful exit code. Only the deleting path needs the detached copy.
if /i "%~1"=="/quiet" (
  set "ROOT=%SITE_ROOT%"
  set "QUIET=1"
  set "DATABAK="
  cd /d "%SYSTEMROOT%"
  goto worker_body
)

set "STAGED=%TEMP%\bw-uninstall-self.cmd"
if not defined STAGED set "STAGED=%HOMEDRIVE%\bw-uninstall-self.cmd"
copy /y "%~f0" "%STAGED%" 1>nul 2>nul
if errorlevel 1 (
  echo [X] could not put a copy of this script into %TEMP%.
  echo     Nothing has been deleted. Either copy the installer folder somewhere
  echo     else ^(for example your desktop^) and run uninstall.cmd from there, or
  echo     stop the site and delete this folder by hand:  %SITE_ROOT%
  pause
  exit /b 4
)

set "W_QUIET="
set "W_BAK="
if /i "%~1"=="/quiet" set "W_QUIET=/quiet"
if /i "%~1"=="/data" set "W_BAK=%~2"

rem start returns straight away and the exit /b on this same line is already
rem parsed, so the launcher is gone long before the copy starts deleting.
start "" "%STAGED%" /worker "%SITE_ROOT%" "%W_QUIET%" "%W_BAK%" & exit /b 0


rem ----------------------------------------------------------------------------
rem  worker - runs from %TEMP%, outside the tree.
rem  The site root arrives as an argument because %~dp0 of this copy is %TEMP%,
rem  and every guard below compares against it.
rem ----------------------------------------------------------------------------
:worker
set "ROOT=%~2"
set "QUIET=0"
set "DATABAK="
if /i "%~3"=="/quiet" set "QUIET=1"
if not "%~4"=="" set "DATABAK=%~4"

:worker_body

cd /d "%SYSTEMROOT%"

if not defined ROOT (
  echo [X] no site root was passed in. Nothing was done.
  pause
  exit /b 1
)
if not exist "%ROOT%\api\src\index.js" (
  echo [X] "%ROOT%" has no api\src\index.js, so it does not look like a Bianwang
  echo     site. Nothing was deleted. If you moved or renamed the install, run
  echo     uninstall.cmd from the installer folder inside the moved copy.
  pause
  exit /b 1
)

echo ============================================================
echo  Bianwang uninstall
echo  program directory : %ROOT%
echo ============================================================
echo.

if /i "%QUIET%"=="1" goto lightonly

rem ---- what is about to be lost, counted rather than guessed at ----
rem Counted with PowerShell, not "dir | find /c": a PATH that leads with
rem Git-for-Windows resolves find.exe to GNU find, which does not understand /c
rem and quietly returns a garbage count. Same trap as dashboard\build.cmd.
set "DATAFILES=0"
set "DATAMBS=0"
if exist "%ROOT%\api\data" (
  for /f "usebackq tokens=1,2 delims=|" %%n in (`powershell -NoProfile -Command "$f=@(Get-ChildItem -LiteralPath '%ROOT%\api\data' -Recurse -File -ErrorAction SilentlyContinue); $s=(($f | Measure-Object -Property Length -Sum).Sum); Write-Output ($f.Count.ToString() + '|' + [math]::Round($s/1048576,1))"`) do (
    set "DATAFILES=%%n"
    set "DATAMBS=%%o"
  )
)
echo About to be deleted:
echo    archives, tags, resources, library and the password CSV  - api\data
echo         ^(!DATAFILES! files, !DATAMBS! MB^)
echo    the backend itself                                       - api
echo    the frontend output                                      - web
echo    the dashboard and its scripts                            - dashboard
echo    the docs, ops scripts and nginx snippets                 - docs ops nginx
echo.
echo The credential note at the root of the site goes with it. It is plaintext,
echo so there is no reason to keep it once the site is gone.
echo.

if defined DATABAK goto dobak

set /p "ANSWER=Type DELETE to remove all of the above, or press Enter to cancel: "
if /i not "!ANSWER!"=="DELETE" (
  echo.
  echo Cancelled. Nothing was deleted and no task was touched.
  pause
  exit /b 0
)
set /p "DATABAK=Optional - press Enter to skip the copy, or type a folder to save api\data into: "

:dobak
if defined DATABAK (
  if not exist "%DATABAK%" mkdir "%DATABAK%" 1>nul 2>nul
  if not exist "%DATABAK%" (
    echo [-] cannot create %DATABAK% - continuing without a copy.
    set "DATABAK="
  ) else (
    echo.
    echo [*] copying api\data to %DATABAK%\data ...
    robocopy "%ROOT%\api\data" "%DATABAK%\data" /E /R:1 /W:1 /NFL /NDL /NP 1>nul
    set "RC=!ERRORLEVEL!"
    if !RC! GEQ 8 (
      echo [X] the copy failed, so nothing was deleted. Fix the destination and try again.
      pause
      exit /b 2
    )
    echo [ok] copy kept at %DATABAK%\data
  )
)

:lightonly
rem ---- 1. stop the process holding the port ----
echo.
echo [*] Stopping the backend...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'api.src.index.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ('stopped pid ' + $_.ProcessId) }"
if errorlevel 1 echo [ ] no backend process was running
taskkill /IM BianwangDashboard.exe /F 1>nul 2>nul
if not errorlevel 1 echo [ok] closed the dashboard window

rem ---- 2. scheduled tasks ----
echo.
echo [*] Removing scheduled tasks...
net session 1>nul 2>nul
if errorlevel 1 (
  echo [-] not elevated: the boot-time task needs an admin prompt to remove.
  echo     Run this again from an elevated cmd, or by hand:
  echo         schtasks /delete /tn BianwangSite /f
  echo         schtasks /delete /tn BianwangDashboard /f
) else (
  call :killtask BianwangSite
  call :killtask BianwangDashboard
)

rem ---- 3. per-user autostart leftovers ----
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v BianwangDashboard /f 1>nul 2>nul
if not errorlevel 1 (echo [ok] logon Run value removed) else (echo [ ] no logon Run value was set)

rem dashboard\install.cmd writes the shortcut into the PER-USER Programs folder
rem (the common one needs admin), so that is the one that has to be cleaned.
rem Existence is checked before claiming anything: del reports success just as
rem happily on a path that never existed, which made an earlier version print
rem "[ok] Start Menu shortcut removed" for a shortcut that was not there.
set "LNK_USER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Bianwang Dashboard.lnk"
set "LNK_ALL=%ALLUSERSPROFILE%\Microsoft\Windows\Start Menu\Programs\Bianwang Dashboard.lnk"
set "LNKFOUND="
if exist "%LNK_USER%" set "LNKFOUND=1"
if exist "%LNK_ALL%" set "LNKFOUND=1"
if not defined LNKFOUND (
  echo [ ] no Start Menu shortcut was set
) else (
  del /f /q "%LNK_USER%" 1>nul 2>nul
  del /f /q "%LNK_ALL%" 1>nul 2>nul
  set "STILL="
  if exist "%LNK_USER%" set "STILL=1"
  if exist "%LNK_ALL%" set "STILL=1"
  if defined STILL (echo [X] a Start Menu shortcut is still there - remove it by hand^) else (echo [ok] Start Menu shortcut removed)
)

if /i "%QUIET%"=="1" (
  echo.
  echo ============================================================
  echo  Stopped and unregistered. Files were kept: %ROOT%
  echo  Run uninstall.cmd without /quiet to remove them too.
  echo ============================================================
  pause
  goto cleanup_self
)

rem ---- 4. the files ----
echo.
echo [*] Deleting %ROOT% ...
rd /s /q "%ROOT%" 1>nul 2>nul

rem Judge by looking. rd reports success on a tree it could not fully remove -
rem a console or the dashboard still sitting inside it is enough - so trusting
rem errorlevel here would call a partial delete a clean one.
if exist "%ROOT%" (
  echo [X] %ROOT% is still there - something holds an open handle on it.
  echo     Close the dashboard and any console sitting in that folder, or reboot
  echo     and delete it by hand.
  pause
  goto cleanup_self
)
echo [ok] removed
echo.
echo ============================================================
echo  Uninstalled.
if defined DATABAK echo  Your data copy is still at %DATABAK%\data
echo  Left behind on purpose ^(harmless, and other tools may use them^):
echo    %LocalAppData%\Bianwang     - the dashboard's remembered port
echo ============================================================
pause
goto cleanup_self


rem ----------------------------------------------------------------------------
rem  :killtask - end then unregister one scheduled task, saying which happened
rem ----------------------------------------------------------------------------
:killtask
schtasks /end /tn "%~1" 1>nul 2>nul
schtasks /delete /tn "%~1" /f 1>nul 2>nul
if errorlevel 1 (echo [ ] %~1 was not registered) else (echo [ok] %~1 removed)
exit /b 0


rem ----------------------------------------------------------------------------
rem  :cleanup_self - drop the helper copy. Detached and delayed, because this
rem  script IS that file: deleting it in place would leave cmd with nothing to
rem  read for the next line, which is the very problem this whole layout exists
rem  to avoid. If it lingers, it is a plain ASCII copy with no secrets in it.
rem ----------------------------------------------------------------------------
:cleanup_self
set "MESELF=%~f0"
start "" /b cmd /c "ping -n 6 127.0.0.1 1>nul & del /q /f "%MESELF%""
endlocal
exit /b 0
