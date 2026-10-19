@echo off
rem dsh-session-janitor launcher: starts the standalone page (127.0.0.1:8788) and opens it.
setlocal
set "NODE=C:\Users\lyong\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"
start "session-cleaner" /min "%NODE%" "%~dp0standalone.mjs" --open
