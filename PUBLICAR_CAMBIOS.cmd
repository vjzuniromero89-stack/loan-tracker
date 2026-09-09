@echo off
title Publicar Control de Prestamos
cd /d "%~dp0"

echo ================================================
echo   Publicando los cambios en Control de Prestamos...
echo ================================================
echo.

call npm run deploy

echo.
echo ================================================
echo   Listo. Si no ves ningun error en rojo arriba,
echo   los cambios ya estan publicados.
echo   Puedes cerrar esta ventana.
echo ================================================
echo.
pause
