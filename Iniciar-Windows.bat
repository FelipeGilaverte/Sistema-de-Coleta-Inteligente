@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
    "%~dp0runtime\node.exe" "%~dp0server.cjs" --open
) else (
    where node.exe >nul 2>&1
    if errorlevel 1 (
        echo Instale o Node.js 24 ou use o ZIP portatil da entrega.
        pause
        exit /b 1
    )
    node.exe "%~dp0server.cjs" --open
)
if errorlevel 1 pause
