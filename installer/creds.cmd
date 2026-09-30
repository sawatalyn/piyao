@echo off
setlocal
set "SELF=%~dp0"
rem ============================================================================
rem  Bianwang - CREDENTIALS  (thin wrapper around creds.ps1)
rem
rem  All the work lives in creds.ps1, because the file this opens is named in
rem  Chinese and a batch file cannot carry that name without cmd.exe mangling it
rem  through the OEM codepage. Nothing is piped back here: only the exit code.
rem
rem  Usage:
rem      creds.cmd              print the location and open it in Notepad
rem      creds.cmd /show        report it without opening anything
rem      creds.cmd /root D:\x   look in some other site root
rem ============================================================================

cd /d "%SELF%"

set "ARGS="
set "BW_SITE_ROOT="
:args
if "%~1"=="" goto argsdone
if /i "%~1"=="/show" set "ARGS=-Show"
if /i "%~1"=="/root" ( set "BW_SITE_ROOT=%~2" & shift )
shift
goto args
:argsdone

rem The site root crosses to PowerShell as an environment variable, not as an
rem argument: `powershell -File` hands over an argument's quotes verbatim, so a
rem -Root "C:\site" arrives as the literal string '"C:\site"' and Resolve-Path
rem fails on it. Tested and printed "[ok] found" with exit code 0 for a directory
rem that had no such file - a yes where the truth was no.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SELF%creds.ps1" %ARGS%
set "RC=%ERRORLEVEL%"

if "%RC%"=="2" (
  echo.
  echo     To make it appear, start the site:
  echo         node "%SELF%..\api\src\index.js"
  echo     or double-click  dashboard\BianwangDashboard.exe  and press start.
)
if "%RC%"=="1" (
  echo.
  echo     PowerShell could not read that directory. Check the path, or run
  echo         powershell -ExecutionPolicy Bypass -File creds.ps1 /root ^<path^>
)
endlocal & exit /b %RC%
