@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PY_CMD=py -3.14"

echo ==========================================
echo Boxing CV - Windows automatic setup
echo Python 3.14 64-bit edition
echo ==========================================
echo.

REM --------------------------------------------------
REM Find Python 3.14
REM --------------------------------------------------
%PY_CMD% --version >nul 2>&1
if errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,14) else 1)" >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python 3.14 was not found.
        echo.
        echo Please install Python 3.14 64-bit first.
        echo Official page: https://www.python.org/downloads/windows/
        echo Choose Python 3.14.x - Windows installer ^(64-bit^).
        echo IMPORTANT: during installation, enable "Add python.exe to PATH" if shown.
        echo Then double-click setup_windows.bat again.
        echo.
        pause
        exit /b 1
    )
    set "PY_CMD=python"
)

REM --------------------------------------------------
REM Verify Python is 3.14 and 64-bit
REM --------------------------------------------------
%PY_CMD% -c "import sys,struct; raise SystemExit(0 if sys.version_info[:2] == (3,14) and struct.calcsize('P')*8 == 64 else 1)"
if errorlevel 1 (
    echo [ERROR] This project requires Python 3.14 64-bit.
    echo Your detected Python is not Python 3.14 64-bit.
    echo Official page: https://www.python.org/downloads/windows/
    echo.
    pause
    exit /b 1
)

%PY_CMD% -c "import sys,struct; print('Detected:', sys.version.split()[0], str(struct.calcsize('P')*8) + '-bit')"
echo.

REM --------------------------------------------------
REM If an old virtual environment exists, verify it.
REM Re-create it automatically if it was made with
REM Python 3.12/3.13 or another architecture.
REM --------------------------------------------------
if exist .venv\Scripts\python.exe (
    .venv\Scripts\python.exe -c "import sys,struct; raise SystemExit(0 if sys.version_info[:2] == (3,14) and struct.calcsize('P')*8 == 64 else 1)" >nul 2>&1
    if errorlevel 1 (
        echo Existing .venv is not Python 3.14 64-bit.
        echo Removing old virtual environment...
        rmdir /s /q .venv
    )
)

echo [1/5] Creating Python 3.14 virtual environment...
if not exist .venv (
    %PY_CMD% -m venv .venv
)
if errorlevel 1 goto :fail

echo [2/5] Activating virtual environment...
call .venv\Scripts\activate.bat
if errorlevel 1 goto :fail

echo [3/5] Installing Python packages...
python -m pip install --upgrade pip
if errorlevel 1 goto :fail
python -m pip install -r requirements.txt
if errorlevel 1 goto :fail

echo [4/5] Downloading MediaPipe Pose model...
python download_model.py
if errorlevel 1 goto :fail

echo [5/5] Running compatibility test...
python -c "import sys,struct,cv2,mediapipe,numpy; print('Python:', sys.version.split()[0], str(struct.calcsize('P')*8) + '-bit'); print('OpenCV:', cv2.__version__); print('MediaPipe:', mediapipe.__version__); print('NumPy:', numpy.__version__)"
if errorlevel 1 goto :fail

echo.
echo ==========================================
echo SETUP COMPLETE - Python 3.14 64-bit
echo ==========================================
echo Next:
echo 1. Double-click camera_test.bat
echo 2. If the camera works, double-click run_boxing.bat
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] Setup failed.
echo.
echo If the error occurred while installing/importing MediaPipe,
echo it may be a Python 3.14 compatibility issue on your PC.
echo Take a screenshot of this entire window and send it to ChatGPT.
echo.
pause
exit /b 1
