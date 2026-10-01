@echo off
setlocal
rem Bianwang archive - backend launcher (Windows).
rem Starts the Node API from the packaged api/ folder. Log goes to ops\api.log.
rem NOTE: this file is intentionally ASCII-only; cmd.exe reads .cmd in the OEM
rem codepage, so non-ASCII comments would render as mojibake.

cd /d "%~dp0..\api"
if not exist src\index.js (
  echo [X] api\src\index.js not found. Run this script from inside the unpacked package.
  exit /b 1
)

if "%BW_DATA_DIR%"=="" set "BW_DATA_DIR=%CD%\data"
if "%BW_HOST%"=="" set "BW_HOST=127.0.0.1"
if "%BW_PORT%"=="" set "BW_PORT=8787"
if "%NODE_ENV%"=="" set "NODE_ENV=production"
if "%BW_HASH_PASSWORDS%"=="" set "BW_HASH_PASSWORDS=1"

if not defined BW_SECRET (
  if not exist "%BW_DATA_DIR%\.secret" (
    echo [!] BW_SECRET is unset. First start will create data\.secret with mode 0600.
    echo [!] Multi-instance deployments MUST set the same BW_SECRET, otherwise you
    echo [!] will see random 403 on signed media links and session loss.
  )
)

echo [*] Node version:
node --version 1>nul 2>nul || (echo [X] Node.js not installed, need ^>=20.19.0 & exit /b 1)
rem Protocol follows the certificate: BW_TLS_PFX (or a BW_TLS_KEY/CERT pair) makes
rem node listen with TLS; anything else is plain HTTP, which is the default.
set "BW_SCHEME=http"
if defined BW_TLS_PFX set "BW_SCHEME=https"
if defined BW_TLS_KEY set "BW_SCHEME=https"
echo [*] Serving %BW_SCHEME%://%BW_HOST%:%BW_PORT%  data=%BW_DATA_DIR%  log=ops\api.log
echo.
node src\index.js >> "%~dp0api.log" 2>&1
echo [X] backend exited with code %ERRORLEVEL%, see ops\api.log
exit /b %ERRORLEVEL%
