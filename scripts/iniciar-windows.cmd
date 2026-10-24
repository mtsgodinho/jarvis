@echo off
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
 echo Instale Node.js 22 ou superior antes de iniciar.
 pause
 exit /b 1
)
echo Iniciando Jarvis. O servidor informara o endereco correto. Ctrl+C para encerrar.
node scripts/supervisor.mjs
if errorlevel 1 (
 echo O Jarvis nao iniciou ou encerrou com erro. Leia o diagnostico acima.
 pause
 exit /b 1
)
