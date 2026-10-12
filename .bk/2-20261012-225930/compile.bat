@echo off
setlocal EnableExtensions DisableDelayedExpansion
REM JPano Portfolio - one-command release builder.
REM Run: compile.bat
REM Optional: compile.bat production https://backend.jpano.dev
REM Final output: .\JPano-Release\ with only system, env, database, client, .env.

cd /d "%~dp0" || exit /b 1
set "SOURCE=%CD%"
for %%I in ("%SOURCE%\..") do set "PARENT=%%~fI"
set "RELEASE=%SOURCE%\JPano-Release"
set "STAGING=%PARENT%\jpano-portfolio"
set "BACKUP=%PARENT%\JPano-Release.previous"
set "HAD_PREVIOUS=0"

if not exist "%SOURCE%\.env" (
  echo ERROR: Missing source .env file.
  exit /b 1
)
where go >nul 2>&1
if errorlevel 1 (
  echo ERROR: Go 1.25+ must be installed and available in PATH.
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 20+ must be installed and available in PATH.
  exit /b 1
)
if not exist "%SOURCE%\client\scripts\tools\compile-release.mjs" (
  echo ERROR: Required project build tool is missing.
  exit /b 1
)

REM The existing builder tests require a clean application source root.
REM Temporarily move an older generated release outside the source root.
if exist "%BACKUP%\" (
  echo ERROR: Backup directory already exists: "%BACKUP%"
  echo Move or archive it before compiling again. Nothing was changed.
  exit /b 1
)
if exist "%RELEASE%\" (
  if not exist "%RELEASE%\system\" goto unrelated_release
  if not exist "%RELEASE%\env\" goto unrelated_release
  if not exist "%RELEASE%\database\" goto unrelated_release
  if not exist "%RELEASE%\client\dist\" goto unrelated_release
  if not exist "%RELEASE%\.env" goto unrelated_release
  move "%RELEASE%" "%BACKUP%" >nul
  if errorlevel 1 (
    echo ERROR: Cannot temporarily move the existing release.
    exit /b 1
  )
  set "HAD_PREVIOUS=1"
)

REM Validation, frontend build, secret scan and Go cross-compilation are
REM already performed by the project build tool. No extra commands needed.
echo [JPano] Building release...
node "%SOURCE%\client\scripts\tools\compile-release.mjs" %*
if errorlevel 1 goto build_failed

REM The unmodified build tool creates its staging folder beside the project.
REM Move that completed build INTO the project and trim its release contents.
if not exist "%STAGING%\.jpano-generated" goto package_failed
if exist "%STAGING%\BUILD_INCOMPLETE" goto package_failed
if not exist "%STAGING%\system\windows\jpano-portfolio.exe" goto package_failed
if not exist "%STAGING%\env\client\.env" goto package_failed
if not exist "%STAGING%\env\server\.env" goto package_failed
if not exist "%STAGING%\database\schema.sql" goto package_failed
if not exist "%STAGING%\client\dist\index.html" goto package_failed

REM Keep the selected top-level .env PRIVATE. Never upload it with client/dist.
copy /Y "%SOURCE%\.env" "%STAGING%\.env" >nul
if errorlevel 1 goto package_failed
move "%STAGING%" "%RELEASE%" >nul
if errorlevel 1 goto package_failed

REM Keep exactly: system/, env/, database/, client/dist/, and .env.
if exist "%RELEASE%\client\assets\" rmdir /S /Q "%RELEASE%\client\assets"
if exist "%RELEASE%\server\" rmdir /S /Q "%RELEASE%\server"
if exist "%RELEASE%\DEPLOYMENT_README.md" del /F /Q "%RELEASE%\DEPLOYMENT_README.md"
if exist "%RELEASE%\.jpano-generated" del /F /Q "%RELEASE%\.jpano-generated"
if exist "%RELEASE%\BUILD_INCOMPLETE" del /F /Q "%RELEASE%\BUILD_INCOMPLETE"

if exist "%RELEASE%\client\assets\" goto package_incomplete
if exist "%RELEASE%\server\" goto package_incomplete
if exist "%RELEASE%\.jpano-generated" goto package_incomplete
if exist "%RELEASE%\DEPLOYMENT_README.md" goto package_incomplete

if "%HAD_PREVIOUS%"=="1" rmdir /S /Q "%BACKUP%"
echo.
echo [JPano] Release complete: "%RELEASE%"
echo [JPano] Contents: system\, env\, database\, client\dist\, .env
 echo [JPano] WARNING: .env and env\server\.env contain private configuration.
exit /b 0

:unrelated_release
echo ERROR: "%RELEASE%" is not a recognized JPano release.
echo Move or rename it manually to avoid accidental data loss.
exit /b 1

:build_failed
echo.
echo ERROR: Build failed. No new release was published.
call :restore_previous
exit /b 1

:package_failed
echo.
echo ERROR: Build finished, but required release files are missing or could not be moved.
call :restore_previous
exit /b 1

:package_incomplete
echo.
echo ERROR: Release packaging could not remove all unnecessary files.
echo Check: "%RELEASE%"
exit /b 1

:restore_previous
if "%HAD_PREVIOUS%"=="1" (
  if not exist "%RELEASE%\" move "%BACKUP%" "%RELEASE%" >nul
)
exit /b 0
