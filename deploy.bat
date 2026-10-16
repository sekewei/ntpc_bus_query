@echo off
setlocal
cd /d "%~dp0"

where npx >nul 2>nul
if errorlevel 1 (
  echo Node.js / npx not found in PATH.
  echo Please install Node.js 22+ from https://nodejs.org/
  exit /b 1
)

echo Deploying ntpc-bus-query worker...

npx wrangler deploy
if errorlevel 1 (
  echo.
  echo Cloudflare deployment failed.
  exit /b %errorlevel%
)

echo.
echo Deployment completed successfully.
echo Try a smoke test with:
echo   node scripts/test-client.mjs "R28" 0

echo or:
echo   BASE_URL=https://ntpc-bus-query.sekewei.workers.dev node scripts/test-client.mjs "R28" 0
