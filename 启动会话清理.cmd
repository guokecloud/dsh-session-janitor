@echo off
rem dsh-session-janitor launcher: starts the standalone page (127.0.0.1:8788) and opens it.
setlocal
set "HERE=%~dp0"
set "NODE="
for %%P in (
  "%ProgramFiles%\nodejs\node.exe"
  "%ProgramFiles(x86)%\nodejs\node.exe"
  "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
) do if not defined NODE if exist "%%~P" set "NODE=%%~P"
if not defined NODE for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%N"
if not defined NODE (
  echo [dsh-session-janitor] node.exe not found. Install Node 22+ or edit NODE in this script.
  pause
  exit /b 1
)
start "session-cleaner" /min "%NODE%" "%HERE%standalone.mjs" --open
