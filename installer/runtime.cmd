@echo off
rem ============================================================================
rem  Bianwang - RUNTIME RESOLVER  (shared by every other script in this folder)
rem
rem  The backend is a Node process. There are two honest ways to get one:
rem
rem    1. runtime\BianwangRuntime.exe next to the package root. That file IS
rem       Electron's own executable, renamed: with ELECTRON_RUN_AS_NODE=1 it
rem       behaves exactly like "node <script> <args>" (built-in Node 24.21.0 in
rem       Electron 44.5.1, verified by running the deployed backend under it and
rem       then passing the 48-item API smoke against it).
rem       This is what the offline installer package always has, and it is why
rem       that package needs no Node.js installed at all - which also removes
rem       the "node is not on PATH for the SYSTEM account" trap.
rem
rem    2. node on PATH - the zip form, where the operator installed Node itself.
rem
rem  Order matters: a bundled runtime beats whatever the machine happens to have,
rem  because the bundled one is the version the package was verified against.
rem
rem  Contract for callers (this file deliberately has NO top-level setlocal, so
rem  the variables below survive the "call"):
rem      BW_NODE          executable to run ("node" or a full path)
rem      BW_RUNTIME_KIND  electron | node
rem      BW_RUNTIME_VER   what -v reports, for logging
rem      ELECTRON_RUN_AS_NODE=1 is exported only in the bundled case.
rem  rc 0 = resolved   rc 1 = nothing usable   rc 3 = node on PATH is too old.
rem  Prints nothing on success: each caller words its own result line.
rem  NOTE: ASCII only - cmd.exe reads .cmd in the OEM codepage.
rem ============================================================================

set "BW_NODE="
set "BW_RUNTIME_KIND="
set "BW_RUNTIME_VER="

set "RT_ROOT=%~dp0.."
for %%A in ("%RT_ROOT%") do set "RT_ROOT=%%~fA"
set "BUNDLED=%RT_ROOT%\runtime\BianwangRuntime.exe"

if exist "%BUNDLED%" goto bundled

where node 1>nul 2>nul
if errorlevel 1 goto missing
for /f "delims=" %%v in ('node -v 2^>nul') do set "BW_RUNTIME_VER=%%v"
call :compare "%BW_RUNTIME_VER%"
rem A boot task has nobody to ask, so an old node.exe must not silently win over
rem "not found": starting on an unsupported runtime is worse than not starting.
if not "%REALLY_OK%"=="1" goto stale
set "BW_NODE=node"
set "BW_RUNTIME_KIND=node"
exit /b 0

:bundled
set "BW_NODE=%BUNDLED%"
set "BW_RUNTIME_KIND=electron"
set "ELECTRON_RUN_AS_NODE=1"
for /f "delims=" %%v in ('"%BUNDLED%" -v 2^>nul') do set "BW_RUNTIME_VER=%%v"
exit /b 0

:stale
echo [X] node on PATH is %BW_RUNTIME_VER%, which is below the 20.19.0 floor.
echo     Install a newer Node.js, or delete the bundled runtime check by using
echo     the offline package, which carries its own runtime.
exit /b 3

:missing
exit /b 1

rem ----------------------------------------------------------------------------
rem  compare: is the version in %1 at least 20.19.0?  sets REALLY_OK to 1 / 0.
rem  Same arithmetic as env.cmd, kept in sync by hand on purpose - a batch file
rem  cannot import code. "v24.18.0" style strings are what node prints.
rem ----------------------------------------------------------------------------
:compare
setlocal enabledelayedexpansion
set "REALLY_OK=0"
set "V=%~1"
if "%V%"=="" ( endlocal & set "REALLY_OK=0" & exit /b 0 )
for /f "delims=v. tokens=1,2,3" %%a in ("%V%") do (
  set "MAJ=%%a"
  set "MIN=%%b"
  set "PAT=%%c"
)
if not defined MAJ ( endlocal & set "REALLY_OK=0" & exit /b 0 )
if not defined MIN set "MIN=0"
if not defined PAT set "PAT=0"
for /f "delims=-+ " %%x in ("!PAT!") do set "PAT=%%x"
if !MAJ! GTR 20 set "REALLY_OK=1"
if !MAJ! EQU 20 if !MIN! GTR 19 set "REALLY_OK=1"
if !MAJ! EQU 20 if !MIN! EQU 19 if !PAT! GEQ 0 set "REALLY_OK=1"
endlocal & set "REALLY_OK=%REALLY_OK%"
exit /b 0
