@echo off
setlocal EnableExtensions
REM JPano Portfolio - keep both Windows terminal windows visible for diagnostics.
REM This script does not touch your database or rewrite .env.
cd /d "%~dp0"
if /I "%~1"=="backend" goto BACKEND
if /I "%~1"=="frontend" goto FRONTEND
if not exist "server\go.mod" (
  echo ERROR: server\go.mod is missing.
  pause
  exit /b 1
)
if not exist "client\htmls\vercel\package.json" (
  echo ERROR: client\htmls\vercel\package.json is missing.
  pause
  exit /b 1
)
where go >nul 2>&1
if errorlevel 1 (
  echo ERROR: Go is not in PATH. Install Go 1.25 or newer.
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not in PATH. Install Node.js 20 or newer.
  pause
  exit /b 1
)
echo Starting JPano Go backend and frontend in separate, persistent terminals...
start "JPano Backend" cmd /k ""%~f0" backend"
start "JPano Frontend" cmd /k ""%~f0" frontend"
echo Two terminals were opened. Backend: .env BACKEND_PORT ^(default 48000^).
echo Frontend: http://127.0.0.1:3000  ^|  Admin: http://127.0.0.1:3000/admin
exit /b 0

:BACKEND
cd /d "%~dp0server"
echo.
echo [JPano Backend] Starting Go server. Logs remain visible in this terminal.
go run .
echo.
echo [JPano Backend] Server stopped. The terminal is staying open for inspection.
exit /b %errorlevel%

:FRONTEND
cd /d "%~dp0client\htmls\vercel"
if not exist "node_modules" (
  echo [JPano Frontend] Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. Check messages above.
    exit /b 1
  )
)
echo [JPano Frontend] Building static pages...
call npm run build
if errorlevel 1 (
  echo ERROR: build failed. Check messages above.
  exit /b 1
)
echo [JPano Frontend] Serving build at http://127.0.0.1:3000
call npx --yes serve dist -l 3000
echo.
echo [JPano Frontend] Server stopped. Terminal is staying open for inspection.
exit /b %errorlevel%
