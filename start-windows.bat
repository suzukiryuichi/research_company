@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or newer from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\pdfjs-dist\package.json" (
  echo Installing PDF reader dependencies. Internet access is required once.
  call npm ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Open http://localhost:3000 in your browser after the server starts.
call npm start
pause
