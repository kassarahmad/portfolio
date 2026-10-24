#Requires -Version 5.1
<# AI Locale - aggiornamento: backup dei dati, aggiornamento delle dipendenze Python
   e (facoltativo) di llama.cpp. I tuoi dati e il file .env non vengono toccati. #>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$VPy = Join-Path $Root ".venv\Scripts\python.exe"
Write-Host "1. Backup dei dati..."
& $VPy -m backend.app.cli backup
Write-Host "2. Aggiornamento dipendenze Python..."
& $VPy -m pip install --upgrade -r requirements.txt --quiet
Write-Host "3. llama.cpp e verifica (setup senza scaricare modelli)..."
& (Join-Path $PSScriptRoot "setup.ps1") -SkipModels
Write-Host "Aggiornamento completato. Riavvia con scripts\stop.ps1 e scripts\start.ps1" -ForegroundColor Green
