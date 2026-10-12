@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo JPano Portfolio - source cleanup
echo ============================================================
echo Keeping only the production source layout:
echo   client\
echo   server\
echo   database\
echo   .env
echo   .gitignore
echo   clean.bat
echo   compile.bat
echo.

rem Root allow-list. Preserve .git when this folder is already a repository.
for /f "delims=" %%I in ('dir /b /a') do (
  set "KEEP=0"
  if /i "%%I"=="client" set "KEEP=1"
  if /i "%%I"=="server" set "KEEP=1"
  if /i "%%I"=="database" set "KEEP=1"
  if /i "%%I"==".env" set "KEEP=1"
  if /i "%%I"==".gitignore" set "KEEP=1"
  if /i "%%I"=="clean.bat" set "KEEP=1"
  if /i "%%I"=="compile.bat" set "KEEP=1"
  if /i "%%I"==".git" set "KEEP=1"
  if "!KEEP!"=="0" (
    if exist "%%I\NUL" (
      echo Removing directory: %%I
      rmdir /s /q "%%I" 2>nul
    ) else (
      echo Removing file: %%I
      del /f /q "%%I" 2>nul
    )
  )
)

rem Generated frontend files.
for %%D in ("client\node_modules" "client\dist" "client\.vercel" "client\coverage") do if exist %%D rmdir /s /q %%D
for %%F in ("client\*.log" "client\*.tmp" "client\Thumbs.db" "client\.DS_Store") do del /f /q %%F 2>nul

rem Generated backend files. Source, tests, Go modules and commands are preserved.
for %%D in ("server\bin" "server\dist" "server\tmp" "server\coverage") do if exist %%D rmdir /s /q %%D
for %%F in ("server\*.exe" "server\*.test" "server\*.log" "server\*.tmp" "server\coverage.out" "server\Thumbs.db" "server\.DS_Store") do del /f /q %%F 2>nul

rem Database documentation/temp artifacts are not required at runtime or for compilation.
del /f /q "database\MIGRATION_NOTES.md" 2>nul
del /f /q "database\*.log" "database\*.tmp" "database\Thumbs.db" "database\.DS_Store" 2>nul

echo.
echo PASS: Source cleanup complete.
exit /b 0
