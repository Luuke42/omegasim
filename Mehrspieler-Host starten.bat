@echo off
rem ====================================================================================
rem  Startet den Mehrspieler-Host von OmegaSim.
rem
rem  WARUM ES DIESE DATEI GIBT, und nicht einen Knopf in der App: eine Webseite darf kein
rem  Programm auf dem Rechner starten. Das ist keine fehlende Schnittstelle, sondern die
rem  Grenze, auf der die ganze Sicherheit des Browsers steht - und sie faellt auch dann
rem  nicht, wenn man die App als PWA installiert. Ein Doppelklick hier ist das Naechste,
rem  was man dem Knopf bringen kann.
rem ====================================================================================

cd /d "%~dp0"
title OmegaSim Mehrspieler-Host  (dieses Fenster schliessen beendet ihn)

rem Python finden. Der Startumschalter "py" ist unter Windows der zuverlaessigste Weg;
rem "python" ist der Rueckfall, und wenn beides fehlt, wird es gesagt statt still zu enden.
set PYCMD=
where py >nul 2>nul && set PYCMD=py
if "%PYCMD%"=="" ( where python >nul 2>nul && set PYCMD=python )

if "%PYCMD%"=="" (
    echo.
    echo   Python wurde nicht gefunden.
    echo.
    echo   Der Host ist ein Python-Programm. Es genuegt die normale Fassung von
    echo   python.org - beim Installieren "Add Python to PATH" ankreuzen.
    echo.
    pause
    exit /b 1
)

if not exist "tools\omegasim_host.py" (
    echo.
    echo   tools\omegasim_host.py wurde nicht gefunden.
    echo.
    echo   Diese Datei gehoert in denselben Ordner wie das Projekt. Wer nur sie allein
    echo   heruntergeladen hat, braucht auch den Ordner "tools".
    echo.
    pause
    exit /b 1
)

echo.
echo   OmegaSim Mehrspieler-Host
echo   -------------------------
echo   Die Adresse steht gleich darunter. Sie gehoert in jedem Telefon in das Feld
echo   "Host-Adresse" im Reiter Mehrspieler. Alle muessen im selben WLAN sein.
echo.
echo   Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.

%PYCMD% "tools\omegasim_host.py" --port 8080

rem Faellt das Programm mit einem Fehler heraus, soll man ihn lesen koennen.
echo.
pause
