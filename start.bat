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

echo Starting PortView on http://localhost:6969 ...
start "" http://localhost:6969
node server.js

endlocal
