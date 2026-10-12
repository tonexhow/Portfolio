@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo JPano Portfolio - backend release compiler
echo ============================================================

call "%~dp0clean.bat"
if errorlevel 1 exit /b %errorlevel%

where go >nul 2>nul
if errorlevel 1 (
  echo ERROR: Go 1.25 or newer was not found in PATH.
  exit /b 1
)

if not exist ".env" (
  echo ERROR: Root .env is missing.
  exit /b 1
)
if not exist "database\schema.sql" (
  echo ERROR: database\schema.sql is missing.
  exit /b 1
)

set "OUT=%CD%\jpano"
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%\systems\windows" || exit /b 1
mkdir "%OUT%\systems\macos" || exit /b 1
mkdir "%OUT%\systems\linux" || exit /b 1
mkdir "%OUT%\database" || exit /b 1

pushd "%~dp0server"

echo Checking Go source...
go test ./...
if errorlevel 1 (
  popd
  echo ERROR: Go tests failed. Release was not generated.
  exit /b 1
)

set "CGO_ENABLED=0"

echo Building Windows amd64 hidden executables...
set "GOOS=windows"
set "GOARCH=amd64"
go build -trimpath -ldflags="-s -w -H=windowsgui" -o "%OUT%\systems\windows\start.exe" .
if errorlevel 1 goto :build_failed
go build -trimpath -ldflags="-s -w -H=windowsgui" -o "%OUT%\systems\windows\stop.exe" ./cmd/stop
if errorlevel 1 goto :build_failed

echo Building macOS arm64 executables...
set "GOOS=darwin"
set "GOARCH=arm64"
go build -trimpath -ldflags="-s -w" -o "%OUT%\systems\macos\start" .
if errorlevel 1 goto :build_failed
go build -trimpath -ldflags="-s -w" -o "%OUT%\systems\macos\stop" ./cmd/stop
if errorlevel 1 goto :build_failed

echo Building Linux amd64 executables...
set "GOOS=linux"
set "GOARCH=amd64"
go build -trimpath -ldflags="-s -w" -o "%OUT%\systems\linux\start" .
if errorlevel 1 goto :build_failed
go build -trimpath -ldflags="-s -w" -o "%OUT%\systems\linux\stop" ./cmd/stop
if errorlevel 1 goto :build_failed

popd
set "GOOS="
set "GOARCH="
set "CGO_ENABLED="

copy /y ".env" "%OUT%\.env" >nul || exit /b 1
copy /y "database\schema.sql" "%OUT%\database\schema.sql" >nul || exit /b 1
if exist "database\initial_data.sql" copy /y "database\initial_data.sql" "%OUT%\database\initial_data.sql" >nul

echo.
echo ============================================================
echo Release generated successfully:
echo %OUT%
echo ============================================================
echo jpano\
echo   systems\
echo     windows\start.exe  ^(hidden/no console window^)
echo     windows\stop.exe
echo     macos\start / stop  ^(Apple Silicon arm64^)
echo     linux\start / stop  ^(amd64^)
echo   database\
echo   .env
echo.
exit /b 0

:build_failed
popd
set "GOOS="
set "GOARCH="
set "CGO_ENABLED="
if exist "%OUT%" rmdir /s /q "%OUT%"
echo ERROR: Build failed. Partial release output was removed.
exit /b 1
