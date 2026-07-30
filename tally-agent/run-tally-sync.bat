@echo off
python "%~dp0tally_sync.py"
if errorlevel 1 echo(&echo Something went wrong - see the message above.
echo(
pause
