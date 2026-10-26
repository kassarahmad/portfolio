#Requires -Version 5.1
<# AI Locale - backup e ripristino da terminale.
   scripts\backup.ps1                 crea un backup in data\backups
   scripts\backup.ps1 -List           elenca i backup
   scripts\backup.ps1 -Restore NOME   ripristina (ferma prima AI Locale con stop.ps1)  #>
param([switch]$List, [string]$Restore)
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$VPy = Join-Path $Root ".venv\Scripts\python.exe"
if ($Restore) {
    $pidFile = Join-Path $Root "data\ailocale.pid"
    if ((Test-Path $pidFile) -and (Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue)) {
        Write-Host "Ferma prima AI Locale (scripts\stop.ps1) oppure ripristina dal pannello Sistema." -ForegroundColor Yellow; exit 1
    }
    & $VPy -m backend.app.cli restore $Restore
} elseif ($List) { & $VPy -m backend.app.cli backups }
else { & $VPy -m backend.app.cli backup }
