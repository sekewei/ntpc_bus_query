@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

if "%~1"=="" (
  set "ROUTE=紅28"
) else (
  set "ROUTE=%~1"
)

if "%~2"=="" (
  set "DIR=0"
) else (
  set "DIR=%~2"
)

for /f %%I in ('node -p "encodeURIComponent(process.argv[1])" "%ROUTE%"') do set "ENCODED_ROUTE=%%I"

curl "http://127.0.0.1:8787/api/bus/route?city=NewTaipei&routeName=%ENCODED_ROUTE%&direction=%DIR%"
