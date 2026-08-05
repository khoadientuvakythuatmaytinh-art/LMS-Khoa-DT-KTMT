@echo off
setlocal
cd /d "%~dp0"

rem Stop any old server that is already using port 5500.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5500" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%P >nul 2>nul
)

rem Start the web server from the public folder.
start "ExamFlow Local Server" cmd /k "cd /d ""%~dp0"" && python -m http.server 5500 --bind 127.0.0.1 --directory public"

rem Wait briefly, then open the same origin every time.
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5500/?fresh=%RANDOM%"

endlocal
exit
