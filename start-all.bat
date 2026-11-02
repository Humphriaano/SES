@echo off
REM Starts the full SES EHR stack (Express, staff client, patient portal,
REM CDS service) plus a Cloudflare quick tunnel for the staff client and one
REM for the patient portal, then prints both tunnel URLs together.
REM
REM Tunnel URLs are ephemeral *.trycloudflare.com addresses that change every
REM time this script runs - re-run it and re-read the printed URLs whenever
REM you need fresh links (e.g. after a reboot).

setlocal
set ROOT=%~dp0
set LOGDIR=%ROOT%.tunnel-logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
del /q "%LOGDIR%\*.log" >nul 2>&1

echo Starting SES EHR services...
REM Local LLM for the CDS (Llama 3.2 + nomic-embed-text). Skipped if already running.
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue)) { $env:OLLAMA_HOST='127.0.0.1:11434'; Start-Process -WindowStyle Hidden -FilePath \"$env:LOCALAPPDATA\Programs\Ollama\ollama.exe\" -ArgumentList 'serve' }"
start "SES Express (:5000)"        cmd /k "cd /d %ROOT%server && npx ts-node --transpile-only src/index.ts"
start "SES Staff Client (:5173)"    cmd /k "cd /d %ROOT%client && npm run dev"
start "SES Patient Portal (:5175)" cmd /k "cd /d %ROOT%patient-portal && npm run dev"
start "SES CDS Service (:8000)"    cmd /k "cd /d %ROOT%cds-service && .venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000"

echo Waiting for services to boot...
timeout /t 8 /nobreak >nul

echo Starting Cloudflare tunnels...
start "SES Tunnel - Staff Client" powershell -NoProfile -Command "cloudflared tunnel --url http://localhost:5173 2>&1 | Tee-Object -FilePath '%LOGDIR%\client.log'"
start "SES Tunnel - Patient Portal" powershell -NoProfile -Command "cloudflared tunnel --url http://localhost:5175 2>&1 | Tee-Object -FilePath '%LOGDIR%\portal.log'"

echo Waiting for tunnels to establish...
timeout /t 10 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%report-urls.ps1" -LogDir "%LOGDIR%"

echo.
echo All services are running in their own windows. Close a window or press
echo Ctrl+C inside it to stop that service.
pause
