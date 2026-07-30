@echo off
python "%~dp0ledger_sync.py" --companies
if errorlevel 1 echo(&echo Something went wrong - see the message above.
echo(
pause
