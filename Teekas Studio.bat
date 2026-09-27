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
call :ensure_lib openai_budget openai-budget
call :ensure_lib gemini_budget gemini-budget

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

:: A local checkout in %USERPROFILE% wins over the GitHub copy.
:ensure_lib
"%PYTHON%" -c "import %1" > nul 2>&1
if not errorlevel 1 exit /b 0
if exist "%USERPROFILE%\%1\pyproject.toml" (
    echo   Ставлю общую библиотеку %1...
    "%PYTHON%" -m pip install -e "%USERPROFILE%\%1" -q
) else (
    echo   Ставлю общую библиотеку %1 с GitHub...
    "%PYTHON%" -m pip install "git+https://github.com/biolog-end/%2.git" -q
)
if errorlevel 1 echo   Не удалось установить %1: студия будет работать без учёта квот.
exit /b 0
