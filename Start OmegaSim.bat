@echo off
cd /d "%~dp0"

start "CH Control Server (schliessen zum Beenden)" /min powershell -NoLogo -ExecutionPolicy Bypass -File "serve.ps1"

timeout /t 1 /nobreak >nul

set URL=http://localhost:8990/

where msedge >nul 2>nul
if %errorlevel%==0 (
    start "" msedge --app=%URL% --window-size=1200,860
    goto :eof
)

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%URL% --window-size=1200,860
    goto :eof
)

if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=%URL% --window-size=1200,860
    goto :eof
)

rem Edge not found anywhere obvious - fall back to whatever the default browser is.
start "" %URL%
