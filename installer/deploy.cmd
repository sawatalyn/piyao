@echo off
setlocal enabledelayedexpansion
rem ============================================================================
rem  Bianwang - DEPLOY  (copies an unpacked package into its running location)
rem
rem  Run this from INSIDE the unpacked release package, i.e.
rem      bianwang-1.0.0-nginx\installer\deploy.cmd
rem  It needs a package root next to it that already has api\ and web\dist\,
rem  so it refuses to run from the source repository (there you would just be
rem  copying dev tree, with no resolved dependencies).
rem
rem  What lands where:
rem      <target>\api\           backend + its self-contained node_modules
rem      <target>\web\dist\      frontend static output
rem      <target>\dashboard\     dashboard source, built here into the exe
rem      <target>\docs\  ops\  nginx\
rem      <target>\<credential note>  a Chinese-named .txt the backend writes
rem
rem  Data is preserved on re-deploy: api\data is only seeded when the target
rem  does not have it yet. Re-running this after an upgrade never touches the
rem  archives, uploaded pictures or the password CSV you have been editing.
rem
rem  Usage:
rem      deploy.cmd                    installs to C:\Bianwang
rem      deploy.cmd D:\Sites\bianwang  installs somewhere else
rem ============================================================================

cd /d "%~dp0"

set "SRC=%~dp0.."
set "TARGET=C:\Bianwang"
if not "%~1"=="" set "TARGET=%~1"

echo ============================================================
echo  Bianwang deploy
echo  from : %SRC%
echo  to   : %TARGET%
echo ============================================================
echo.

if not exist "%SRC%\api\src\index.js" (
  echo [X] No %SRC%\api\src\index.js - this does not look like an unpacked release package.
  echo     deploy.cmd lives in the package's installer\ folder and copies the package
  echo     next to it. If you are in the source repository, build the package first:
  echo         node scripts\make-nginx-package.mjs --write --zip
  echo     and run installer\deploy.cmd from inside the resulting zip.
  pause
  exit /b 1
)

rem Copying a directory onto itself is how robocopy eats the source: it reports
rem every file as "skipped, same file" and then, with /MIR-like expectations,
rem people think the deploy failed. Catch it here instead.
for %%A in ("%SRC%")     do set "SRC_ABS=%%~fA"
for %%A in ("%TARGET%")  do set "TGT_ABS=%%~fA"
if /i "!SRC_ABS!"=="!TGT_ABS!" (
  echo [X] The package is already sitting in %TARGET% - deploying onto itself would
  echo     just re-copy files onto their own paths.
  echo     Nothing was changed. If you only want to re-register autostart, run
  echo         autostart.cmd
  echo     If you want the newest files, unpack the new zip somewhere else first.
  pause
  exit /b 6
)
if not exist "%SRC%\web\dist\index.html" (
  echo [X] No %SRC%\web\dist\index.html - the frontend output is missing from the package.
  pause
  exit /b 1
)

where node 1>nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not on PATH, so the deployed site could not start anyway.
  echo     Run installer\env.cmd /install first.
  pause
  exit /b 2
)

echo [*] Checking the target is writable...
if not exist "%TARGET%" (
  mkdir "%TARGET%" 1>nul 2>nul
  if errorlevel 1 (
    echo [X] Could not create %TARGET% - run this from an elevated prompt, or pick a
    echo     directory your account can write to:   deploy.cmd D:\somewhere\bianwang
    pause
    exit /b 3
  )
)
echo [ok] target ready

rem api\data is user data the moment the site has run once. Decide up front whether
rem it gets seeded, and exclude it from the copy either way.
set "SEED_DATA=0"
if not exist "%TARGET%\api\data\posts.json" (
  set "SEED_DATA=1"
  echo [*] api\data not present in the target - it will be copied with the factory demo data.
) else (
  echo [*] api\data already exists in the target - keeping it as is, the copy will skip it.
)
echo.

echo [*] Copying ^(robocopy; this is the part that takes a minute^)...
for %%D in (api web nginx docs ops dashboard installer) do (
  if exist "%SRC%\%%D" (
    robocopy "%SRC%\%%D" "%TARGET%\%%D" /E /XD "%TARGET%\api\data" /XF .secret sessions.json security.log login-attempts.json /R:1 /W:1 /NFL /NDL /NP 1>nul
    set "RC=!ERRORLEVEL!"
    if !RC! GEQ 8 (
      echo [X] robocopy failed on %%D ^(code !RC!^)
      pause
      exit /b 4
    )
    echo [ok] %%D
  )
)

if "%SEED_DATA%"=="1" (
  echo [*] Seeding api\data with the factory demo content...
  robocopy "%SRC%\api\data" "%TARGET%\api\data" /E /XF .secret sessions.json security.log login-attempts.json /R:1 /W:1 /NFL /NDL /NP 1>nul
  set "RC=!ERRORLEVEL!"
  if !RC! GEQ 8 (
    echo [X] could not seed api\data ^(code !RC!^)
    pause
    exit /b 5
  )
  echo [ok] data seeded
)

echo.
echo [*] Building the dashboard exe on this machine ^(nothing binary is trusted from the zip^)...
pushd "%TARGET%\dashboard"
call build.cmd 1>nul
set "RC=!ERRORLEVEL!"
popd
if not "%RC%"=="0" (
  echo [-] Dashboard build did not succeed. The site itself is fine - you can still
  echo     start it with   node "%TARGET%\api\src\index.js"   and, once you have
  echo     fixed the compiler ^(.NET Framework 4.x optional feature^), re-run
  echo     "%TARGET%\dashboard\build.cmd".
) else (
  if exist "%TARGET%\dashboard\BianwangDashboard.exe" (
    echo [ok] dashboard\BianwangDashboard.exe
  ) else (
    echo [-] build.cmd reported success but the exe is not there.
  )
)

echo.
echo ============================================================
echo  Deployed to %TARGET%
echo    start by hand  :  dashboard\BianwangDashboard.exe
echo    or             :  installer\run-site.cmd       ^(console, no GUI^)
echo    the port is typed into the dashboard every time it is started
echo    by hand; autostart reuses the one you last confirmed.
echo    The credential note ^(a Chinese-named .txt^) is written by the backend
echo    into %TARGET%\ on its FIRST START - open it with installer\creds.cmd.
echo ============================================================
exit /b 0
