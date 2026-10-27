@echo off
rem The terminal command: `netherstone .` opens this folder as a vault,
rem `netherstone notes.md` imports a file. `start` hands over to the app
rem without holding the terminal.
start "" "%~dp0..\Netherstone.exe" %*
