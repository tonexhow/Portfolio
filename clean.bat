@echo off
setlocal EnableExtensions DisableDelayedExpansion
REM JPano safe cleanup and source-layout migration.
REM compile.bat calls: clean.bat migrate
REM clean.bat alone also performs only the safe migration.
REM clean.bat generated additionally removes disposable frontend build output.
cd /d "%~dp0" || exit /b 1
if /I "%~1"=="help" goto help
if /I "%~1"=="/?" goto help
if /I "%~1"=="generated" goto generated
if "%~1"=="" goto migrate
if /I "%~1"=="migrate" goto migrate
echo ERROR: Unknown option "%~1".
goto help_error

:generated
if exist "client\htmls\vercel\dist\" (
  echo [JPano] Removing generated Vercel frontend dist...
  rmdir /S /Q "client\htmls\vercel\dist" || exit /b 1
)
echo [JPano] Private .env, JPano-Release, logs and database files were preserved.
goto migrate

:migrate
REM Older patches left copies of the old root Go handlers. Archive only
REM handlers already present under internal\application. Never remove unknown
REM custom files, server\main.go, or private configuration.
set "MIGRATED=0"
for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%T"
if not defined STAMP set "STAMP=backup"
set "ARCHIVE=server\.migration-backup\%STAMP%"
for %%F in (access.go admin.go ai.go ai_gateway.go ai_replies.go application_test.go career.go certificates.go chat.go chat_images.go database_rows.go email.go email_content.go email_test.go feedback_auth.go health_diagnostics.go health_diagnostics_test.go host_storage_darwin.go host_storage_linux.go host_storage_other.go host_storage_windows.go host_telemetry_linux.go host_telemetry_other.go host_telemetry_windows.go http_policy.go information.go network_diagnostics.go operations.go payment_reconcile.go project_inquiries.go project_offers.go projects.go secure_network.go transactions.go websocket.go) do (
  if exist "server\%%F" if exist "server\internal\application\%%F" (
    if not exist "%ARCHIVE%\" mkdir "%ARCHIVE%" || exit /b 1
    move "server\%%F" "%ARCHIVE%\%%F" >nul || exit /b 1
    set "MIGRATED=1"
  )
)
if "%MIGRATED%"=="1" (
  echo [JPano] Superseded Go source archived to "%ARCHIVE%".
) else (
  echo [JPano] No superseded Go handlers found.
)
echo [JPano] No private files or previous compiled release were deleted.
exit /b 0

:help
 echo Usage: clean.bat [migrate ^| generated ^| help]
 echo migrate   - Archive only known duplicated Go handlers. Safe for compile.bat.
 echo generated - Also remove disposable frontend dist. Keep binaries, logs, .env.
 exit /b 0
:help_error
exit /b 1
