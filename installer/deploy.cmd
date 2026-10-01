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
rem      <target>\runtime\       offline form only: Electron used as the Node
rem                              runtime (BianwangRuntime.exe). Nothing else
rem                              reads it; runtime.cmd is the single place that
rem                              decides whether the site runs on it or on node.
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
rem      deploy.cmd D:\Bianwang /inplace
rem                          the offline package has ALREADY been unpacked into
rem                          the directory it will run from (NSIS put it there),
rem                          so there is nothing to copy: this checks the tree,
rem                          seeds api\data if the site never ran, and builds the
rem                          dashboard. Same postconditions, no 400 MB of robocopy.
rem ============================================================================

cd /d "%~dp0"

set "SRC=%~dp0.."
set "TARGET=C:\Bianwang"
set "INPLACE=0"
if not "%~1"=="" set "TARGET=%~1"
if /i "%~2"=="/inplace" set "INPLACE=1"

echo ============================================================
echo  Bianwang deploy
echo  from : %SRC%
echo  to   : %TARGET%
if "%INPLACE%"=="1" echo  mode: in-place ^(the package is already where it runs^)
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
if "%INPLACE%"=="0" if /i "!SRC_ABS!"=="!TGT_ABS!" (
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

rem What has to be able to run the backend afterwards is resolved the same way
rem run-site.cmd will resolve it, so "deploy said ok but the site will not start"
rem cannot happen: the offline package's own runtime wins, node on PATH is the
rem fallback, and an old node is a refusal rather than a surprise.
call "%~dp0runtime.cmd"
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  if "!RC!"=="3" (
    echo [X] The node on PATH is older than 20.19.0, so the deployed site could not run.
    echo     Update it ^(installer\env.cmd /install^) or deploy the offline package,
    echo     which carries its own runtime.
  ) else (
    echo [X] No usable runtime: this package has no runtime\BianwangRuntime.exe and
    echo     there is no node on PATH. Run installer\env.cmd /install first.
  )
  pause
  exit /b 2
)
echo [ok] runtime to run the site: !BW_RUNTIME_KIND! !BW_RUNTIME_VER!

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
  if "%INPLACE%"=="1" (
    echo [*] api\data has no posts.json - it will be re-seeded from the package's own
    echo     api\scripts\reseed.js ^(there is nothing to copy from: source and target
    echo     are the same directory in this mode^).
  ) else (
    echo [*] api\data not present in the target - it will be copied with the factory demo data.
  )
) else (
  echo [*] api\data already exists in the target - keeping it as is, the copy will skip it.
)
echo.

if "%INPLACE%"=="1" goto copied
echo [*] Copying ^(robocopy; this is the part that takes a minute^)...
for %%D in (api web nginx docs ops dashboard installer runtime) do (
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

:copied
if "%SEED_DATA%"=="0" goto seeded
echo [*] Seeding api\data with the factory demo content...
if "%INPLACE%"=="1" (
  pushd "%TARGET%\api"
  "%BW_NODE%" "scripts\reseed.js" 1>nul 2>nul
  set "RC=!ERRORLEVEL!"
  popd
  if not "!RC!"=="0" goto seedfail
) else (
  robocopy "%SRC%\api\data" "%TARGET%\api\data" /E /XF .secret sessions.json security.log login-attempts.json /R:1 /W:1 /NFL /NDL /NP 1>nul
  set "RC=!ERRORLEVEL!"
  rem robocopy is fine with anything below 8; treating 1 as failure would abort
  rem every normal deploy.
  if !RC! GEQ 8 goto seedfail
)
rem reseed touches data\.secret (the master key for sessions, image links and
rem library tokens). A deployed package must let the machine mint its own on
rem first start, so the one generated here goes away again.
if exist "%TARGET%\api\data\.secret" del /q "%TARGET%\api\data\.secret" 1>nul 2>nul
echo [ok] data seeded
goto seeded
:seedfail
echo [X] could not seed api\data ^(code !RC!^)
pause
exit /b 5
:seeded

echo.
echo [*] Building the dashboard exe on this machine ^(nothing binary is trusted from the zip^)...
pushd "%TARGET%\dashboard"
call build.cmd 1>nul
set "RC=!ERRORLEVEL!"
popd
if not "%RC%"=="0" (
  echo [-] Dashboard build did not succeed. The site itself is fine - you can still
  echo     start it with   "!BW_NODE!" "%TARGET%\api\src\index.js"   and, once you have
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
