@echo off
cd /d "%~dp0.."
echo Esta opcao altera somente o atalho do Jarvis na pasta Inicializar do seu usuario.
echo O microfone nao sera habilitado por este comando.
choice /C HDN /N /M "H: habilitar; D: desabilitar; N: cancelar: "
if errorlevel 3 exit /b 0
if errorlevel 2 (
 node scripts/autostart-windows.mjs --disable
) else (
 node scripts/autostart-windows.mjs --enable
)
pause
