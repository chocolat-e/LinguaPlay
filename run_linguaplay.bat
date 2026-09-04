@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Starts the three processes that make up LinguaPlay, each in its own window
REM so any one of them can be read, restarted, or closed on its own.
REM
REM The ESP32 is the fourth part and needs no window: it pushes to the bridge
REM by itself as soon as it has WiFi. Nothing here waits for it, and the game
REM is playable on the keyboard before any of it is connected.

set "PY=py"
if exist .venv\Scripts\python.exe set "PY=.venv\Scripts\python.exe"

echo ==========================================
echo LinguaPlay - starting the whole system
echo ==========================================
echo.

echo [1/3] Device bridge on port 5000...
start "LinguaPlay bridge" cmd /k "%PY%" bridge.py

REM The bridge has to be accepting connections before the other two start
REM pushing, or both spend their first seconds printing connection errors.
timeout /t 2 /nobreak >nul

echo [2/3] Computer vision tracker...
start "LinguaPlay vision" cmd /k "%PY%" "computer vision.py"

echo [3/3] Game (http://localhost:5173)...
start "LinguaPlay game" cmd /k "cd software && npm run dev"

echo.
echo All three started. The game opens at http://localhost:5173
echo.
echo If the controller does not show as connected in the menu:
echo   - check API_URL in controller.ino points at this PC's IPv4 address
echo   - check the ESP32 and this PC are on the same 2.4 GHz network
echo   - open http://127.0.0.1:5000/api/health to see what the bridge is hearing
echo.
pause
