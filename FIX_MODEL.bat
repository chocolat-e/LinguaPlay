@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================
echo Fix MediaPipe Pose model
echo ==========================================
echo.

if not exist .venv\Scripts\python.exe (
    echo [ERROR] Python virtual environment was not found.
    echo Please run setup_windows.bat first.
    pause
    exit /b 1
)

if not exist models mkdir models

REM First try the Python downloader.
.venv\Scripts\python.exe download_model.py
if not errorlevel 1 goto :verify

echo.
echo Python download failed. Trying PowerShell...
echo.

if exist models\pose_landmarker_lite.task del /q models\pose_landmarker_lite.task
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' -OutFile 'models\pose_landmarker_lite.task'"
if errorlevel 1 goto :manual

:verify
.venv\Scripts\python.exe -c "from pathlib import Path; p=Path(r'models\pose_landmarker_lite.task'); import sys; print('Model path:', p.resolve()); print('Model size:', p.stat().st_size if p.exists() else 0, 'bytes'); raise SystemExit(0 if p.exists() and p.stat().st_size >= 1000000 else 1)"
if errorlevel 1 goto :manual

echo.
echo ==========================================
echo MODEL FIXED SUCCESSFULLY
echo ==========================================
echo.
echo Now run run_boxing.bat again.
pause
exit /b 0

:manual
echo.
echo ==========================================
echo AUTOMATIC DOWNLOAD FAILED
echo ==========================================
echo.
echo Open this link in your web browser:
echo https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
echo.
echo Save it as:
echo pose_landmarker_lite.task
echo.
echo Then put it in this folder:
echo %CD%\models
echo.
echo IMPORTANT: The file should be several MB, not 0 KB.
echo Then run run_boxing.bat again.
pause
exit /b 1
