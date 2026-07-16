@echo off
python "%~dp0stock_export.py"
if errorlevel 1 echo(&echo Something went wrong - see the message above.
echo(
pause
