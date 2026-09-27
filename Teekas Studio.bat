@echo off
chcp 65001 > nul
title Teekas Studio
cd /d "%~dp0"

:: Starts the studio server and opens the control panel in the browser.
:: When the studio is already running, only the panel is opened.

if not defined PORT set "PORT=8765"
set "PANEL_URL=http://127.0.0.1:%PORT%/control"

set "PYTHON=python"
if exist ".venv\Scripts\python.exe" set "PYTHON=.venv\Scripts\python.exe"

"%PYTHON%" --version > nul 2>&1
if errorlevel 1 (
    echo.
    echo   Python не найден. Установите его с python.org
    echo   и поставьте галочку "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

"%PYTHON%" -c "import urllib.request as u; u.urlopen('%PANEL_URL%', timeout=2)" > nul 2>&1
if not errorlevel 1 (
    echo   Студия уже запущена — открываю панель.
    start "" "%PANEL_URL%"
    exit /b 0
)

"%PYTHON%" -c "import flask, gtts, pydub, PIL, colorama, keyboard, openai; from google import genai" > nul 2>&1
if errorlevel 1 (
    echo.
    echo   Первый запуск: устанавливаю зависимости, это займёт минуту...
    echo.
    "%PYTHON%" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo   Не удалось установить зависимости. Смотрите ошибку выше.
        pause
        exit /b 1
    )
)

:: Free-tier counters are shared by all projects of this Windows user.
for %%L in (openai_budget gemini_budget) do (
    "%PYTHON%" -c "import %%L" > nul 2>&1
    if errorlevel 1 if exist "%USERPROFILE%\%%L\pyproject.toml" (
        echo   Ставлю общую библиотеку %%L...
        "%PYTHON%" -m pip install -e "%USERPROFILE%\%%L" -q
    )
)

echo.
echo   Студия запускается. Панель откроется в браузере сама.
echo   Не закрывайте это окно, пока идёт эфир.
echo.
set "OPEN_BROWSER=1"
set "PYTHONIOENCODING=utf-8"
"%PYTHON%" main.py
set "APP_EXIT_CODE=%ERRORLEVEL%"
if "%APP_EXIT_CODE%"=="0" exit /b 0

echo.
echo   Студия остановлена с ошибкой %APP_EXIT_CODE%. Смотрите сообщение выше.
pause
exit /b %APP_EXIT_CODE%
