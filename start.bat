@echo off
REM Start PortView and open it in the default browser.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js 18 or newer and try again.
  pause
  exit /b 1
)

REM The server reads PORT too, so the browser opens the address it will serve.
if not defined PORT set "PORT=6969"

echo Starting PortView on http://localhost:%PORT% ...
start "" "http://localhost:%PORT%/"
node server.js

endlocal
