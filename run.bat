@echo off
rem Usage:
rem   run.bat          Starts the local Cloudflare Worker normally.
rem   run.bat reset    Stops stale local processes and clears Wrangler local cache before starting.
rem
rem This script is for local development only. Use deploy.bat to deploy to Cloudflare.
setlocal
cd /d "%~dp0"

set "RESET_LOCAL=0"
if /I "%~1"=="reset" set "RESET_LOCAL=1"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found in PATH.
  echo Please install Node 22+ from https://nodejs.org/
  exit /b 1
)

node --version >nul 2>nul
if errorlevel 1 (
  echo Node.js not found in PATH.
  exit /b 1
)

if "%RESET_LOCAL%"=="1" (
  echo Running reset mode for local Worker...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = 8787; $pids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($id in $pids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Host \"Killed port 8787 PID $id\" }; Get-CimInstance Win32_Process -Filter \"Name = 'node.exe' OR Name = 'wrangler.exe'\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host \"Killed $($_.Name) PID $($_.ProcessId)\" }"

  rem Clear Wrangler's stale local dev registry for this app.
  if exist "%APPDATA%\xdg.config\.wrangler\registry\ntpc-bus-query" (
    rmdir /s /q "%APPDATA%\xdg.config\.wrangler\registry\ntpc-bus-query"
    echo Cleared stale Wrangler registry for ntpc-bus-query
  )

  rem Also clear old Worker logs so the next run is not reusing cached debug state.
  if exist "%APPDATA%\xdg.config\.wrangler\logs" (
    rmdir /s /q "%APPDATA%\xdg.config\.wrangler\logs"
    echo Cleared stale Wrangler logs
  )
)

echo Starting local worker...
if "%RESET_LOCAL%"=="1" (
  echo (reset mode enabled)
)

node .\node_modules\wrangler\bin\wrangler.js dev --local --ip 127.0.0.1 --port 8787 --log-level info
