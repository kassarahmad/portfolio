#Requires -Version 5.1
<#
  AI Locale - avvio. Avvia il server in background (con llama-server, se configurato)
  e apre il browser.   Uso: powershell -ExecutionPolicy Bypass -File scripts\start.ps1
#>
param([switch]$NoBrowser)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$VPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $VPy)) { Write-Host "Ambiente non installato: esegui prima scripts\setup.ps1" -ForegroundColor Yellow; exit 1 }

$port = 8765
if (Test-Path ".env") {
    $m = Select-String -Path ".env" -Pattern '^AILOCALE_PORT=(\d+)' | Select-Object -First 1
    if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
}
$url = "http://127.0.0.1:$port"
New-Item -ItemType Directory -Force -Path "data\logs" | Out-Null
$pidFile = Join-Path $Root "data\ailocale.pid"

if (Test-Path $pidFile) {
    $old = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
        Write-Host "AI Locale e' gia' in esecuzione (PID $old): $url"
        if (-not $NoBrowser) { Start-Process $url }
        exit 0
    }
}

$p = Start-Process -FilePath $VPy -ArgumentList "-m", "backend.app.main" -WorkingDirectory $Root `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "data\logs\console.out.log" -RedirectStandardError "data\logs\console.err.log"
Set-Content -Path $pidFile -Value $p.Id

Write-Host "Avvio di AI Locale (PID $($p.Id))..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if ($p.HasExited) { break }
    try {
        $r = Invoke-WebRequest "$url/api/me" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
}
if (-not $ready) {
    Write-Host "Avvio non riuscito. Ultime righe del log:" -ForegroundColor Red
    Get-Content "data\logs\console.err.log" -Tail 25 -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "AI Locale e' pronto su $url" -ForegroundColor Green
Write-Host "Il modello AI puo' impiegare qualche secondo a caricarsi in VRAM: l'indicatore in alto diventa verde quando e' pronto."
Write-Host "Per fermarlo: scripts\stop.ps1"
if (-not $NoBrowser) { Start-Process $url }
