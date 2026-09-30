@echo off
setlocal enabledelayedexpansion
rem ============================================================================
rem  Bianwang - RUNTIME ENVIRONMENT  monitor / install / update
rem
rem  One-click check of what the site actually needs at run time, and an opt-in
rem  install or update through Windows' own package manager (winget):
rem
rem    * Node.js  >= 20.19.0   REQUIRED - the backend IS a node process
rem    * pnpm                   only needed if you run from the *source* tree;
rem                             the deployed package ships its dependencies
rem                             already resolved inside api\node_modules, so a
rem                             plain deployment does NOT need pnpm at all
rem    * winget                 the installer path; if absent we stop installing
rem                             and hand you the official download page instead
rem
rem  Design rules this file follows:
rem    - it never silently installs. Detection is free, installation needs the
rem      /install switch (setup.cmd passes it after you answer yes once);
rem    - everything network goes through the corporate proxy at 127.0.0.1:7897,
rem      overridable with BW_PROXY;
rem    - if winget is missing or its download fails (proxy, policy, offline
rem      machine) it degrades to "print the exact URL + open it for you", which
rem      is still a working path, just one you click through yourself.
rem
rem  Usage:
rem    env.cmd              check only, print a table, exit 0 ok / 2 something
rem    env.cmd /install     check, then install or update whatever is missing
rem  NOTE: intentionally ASCII-only - cmd.exe reads .cmd in the OEM codepage.
rem ============================================================================

set "MIN_MAJOR=20"
set "MIN_MINOR=19"
set "MIN_PATCH=0"
set "PROXY=%BW_PROXY%"
if not defined PROXY set "PROXY=http://127.0.0.1:7897"
set "NODE_URL=https://nodejs.org/en/download"

set "DO_INSTALL=0"
if /i "%~1"=="/install" set "DO_INSTALL=1"

echo ============================================================
echo  Bianwang runtime environment check
echo  required: Node.js ^>=%MIN_MAJOR%.%MIN_MINOR%.%MIN_PATCH%   proxy: %PROXY%
echo ============================================================
echo.

set "NODE_OK=0"
set "NODE_VER="
where node 1>nul 2>nul
if errorlevel 1 (
  echo [missing] Node.js        : not on PATH
) else (
  for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
  call :compare "!NODE_VER!"
  if "!REALLY_OK!"=="1" (
    set "NODE_OK=1"
    echo [ok] Node.js        : !NODE_VER!
  ) else (
    echo [too old] Node.js   : !NODE_VER!  -- needs %MIN_MAJOR%.%MIN_MINOR%.%MIN_PATCH% or newer
  )
)

rem pnpm is only a source-tree concern; report it but never block on it.
set "PNPM_OK=0"
where pnpm 1>nul 2>nul
if errorlevel 1 (
  echo [info] pnpm           : not installed - only needed to run from source
) else (
  for /f "delims=" %%p in ('pnpm -v 2^>nul') do set "PNPM_VER=%%p"
  set "PNPM_OK=1"
  echo [ok] pnpm           : !PNPM_VER!
)

set "WINGET_OK=0"
where winget 1>nul 2>nul
if errorlevel 1 (
  echo [info] winget         : not available - installs will fall back to guidance
) else (
  for /f "delims=" %%w in ('winget --version 2^>nul') do set "WINGET_VER=%%w"
  set "WINGET_OK=1"
  echo [ok] winget         : !WINGET_VER!
)

echo.
if "%NODE_OK%"=="1" (
  echo Result: Node.js is fine. Nothing to do.
  exit /b 0
)

echo Result: Node.js is missing or too old - the site cannot start without it.
echo.

if "%DO_INSTALL%"=="0" (
  echo This run was check-only. Re-run with /install to let it fix this:
  echo     env.cmd /install
  echo or install it yourself from the page below.
  echo     %NODE_URL%
  exit /b 2
)

if "%WINGET_OK%"=="0" (
  echo [X] winget is not on this machine, so there is nothing to install with.
  echo     Windows 10 before 1809 and some Server SKUs ship without it.
  echo     Getting Node.js manually:
  echo        1. download the LTS .msi from   %NODE_URL%
  echo           ^(if the direct download is blocked, the proxy is %PROXY%^)
  echo        2. run the .msi, next-next-finish
  echo        3. open a NEW console and check   node -v
  echo     Re-run this script afterwards; the rest of the install will pick it up.
  start "" "%NODE_URL%"
  exit /b 3
)

echo [*] Installing / updating Node.js LTS through winget ^(needs the network,
echo     behind this machine's proxy: %PROXY%^)...
echo.

rem winget reads the WinHTTP proxy, not HTTP_PROXY, so surface both: the env
rem vars are for anything winget shells out to, and the hint below covers the
rem case where its own fetch is the thing that gets blocked.
set "HTTP_PROXY=%PROXY%"
set "HTTPS_PROXY=%PROXY%"
set "ALLUSERSPROFILE=%ALLUSERSPROFILE%"

winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo [-] winget install exited with code %RC%.
  echo     Most common causes on a managed machine: the source has never been
  echo     accepted ^(run   winget source update   once^), or the fetch is blocked
  echo     by the proxy. Falling back to the manual page.
  echo        %NODE_URL%
  start "" "%NODE_URL%"
  exit /b 4
)

rem A fresh install does not appear in this console's PATH - resolve it directly.
set "NODE_BIN="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_BIN if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_BIN=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE_BIN (
  echo [X] winget reported success but node.exe is not where an install puts it.
  echo     Open a new console and check   node -v   - if it is there, re-run setup.cmd.
  exit /b 5
)
set "PATH=%ProgramFiles%\nodejs;%PATH%"
for /f "delims=" %%v in ('"%NODE_BIN%" -v 2^>nul') do set "NODE_VER=%%v"
echo [ok] Node.js installed via winget: !NODE_VER!
echo.
echo Done. Re-run setup.cmd - it will continue from here.
exit /b 0


rem ----------------------------------------------------------------------------
rem  compare: is the version in %1 at least MIN_MAJOR.MIN_MINOR.MIN_PATCH?
rem  sets REALLY_OK to 1 / 0. "v24.14.1" style strings are what node prints.
rem ----------------------------------------------------------------------------
:compare
set "REALLY_OK=0"
set "V=%~1"
if "%V%"=="" exit /b 0
for /f "delims=v. tokens=1,2,3" %%a in ("%V%") do (
  set "MAJ=%%a"
  set "MIN=%%b"
  set "PAT=%%c"
)
if not defined MAJ exit /b 0
if not defined MIN set "MIN=0"
if not defined PAT set "PAT=0"
for /f "delims=-+ " %%x in ("!PAT!") do set "PAT=%%x"
if !MAJ! GTR %MIN_MAJOR% set "REALLY_OK=1"
if !MAJ! EQU %MIN_MAJOR% if !MIN! GTR %MIN_MINOR% set "REALLY_OK=1"
if !MAJ! EQU %MIN_MAJOR% if !MIN! EQU %MIN_MINOR% if !PAT! GEQ %MIN_PATCH% set "REALLY_OK=1"
exit /b 0
