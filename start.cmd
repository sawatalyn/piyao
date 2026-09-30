@echo off
setlocal
rem ============================================================================
rem  Bianwang archive - one-click launcher FROM SOURCE (Windows).
rem  Double-click to start. It does, in order, only what is still missing:
rem    1. pnpm install            (if node_modules is absent)
rem    2. node server/scripts/reseed.js   (if server/data/posts.json is absent)
rem    3. pnpm build              (if web/dist/index.html is absent)
rem    4. pnpm start              (production single-port: serves web/dist + API)
rem  First run needs a few minutes (install + build); later runs start fast.
rem  Keep this window open while the site is running. Press Ctrl+C to stop.
rem  NOTE: intentionally ASCII-only - cmd.exe reads .cmd in the OEM codepage,
rem        so non-ASCII comments would render as mojibake.
rem ============================================================================

cd /d "%~dp0"

where pnpm >nul 2>nul || (
  echo [X] pnpm not found. Install it first:  npm install -g pnpm
  pause
  exit /b 1
)

if not exist node_modules (
  echo [*] Installing dependencies...
  echo     ^(.npmrc points at proxy http://127.0.0.1:7897 - edit/delete it if you have no proxy^)
  call pnpm install || (echo [X] pnpm install failed & pause & exit /b 1)
)

if not exist server\data\posts.json (
  echo [*] Writing first-run demo data ^(6 posts + media + 3 self-made books^)...
  node server\scripts\reseed.js || (echo [X] reseed failed & pause & exit /b 1)
)

if not exist web\dist\index.html (
  echo [*] Building frontend into web\dist ...
  call pnpm build || (echo [X] build failed & pause & exit /b 1)
)

if "%BW_PORT%"=="" set "BW_PORT=8787"
if "%BW_HOST%"=="" set "BW_HOST=127.0.0.1"
if "%NODE_ENV%"=="" set "NODE_ENV=production"

echo.
echo  [*] Bianwang is starting at  http://%BW_HOST%:%BW_PORT%
echo      default login  admin / admin   - CHANGE THE PASSWORD AFTER FIRST LOGIN
echo      for hot-reload dev instead, run:  pnpm dev   ^(API 8787 + web 5173^)
echo      keep this window open; press Ctrl+C to stop.
echo.
call pnpm start
echo [X] server exited with code %ERRORLEVEL%
pause
exit /b %ERRORLEVEL%
