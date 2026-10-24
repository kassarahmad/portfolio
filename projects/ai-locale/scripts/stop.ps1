#Requires -Version 5.1
# AI Locale - arresto del server e dei processi llama-server avviati da questo progetto.
$Root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $Root "data\ailocale.pid"
if (Test-Path $pidFile) {
    $id = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $id -Force
        Write-Host "Server AI Locale arrestato (PID $id)."
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
} else {
    Write-Host "Nessun PID salvato: AI Locale non sembra in esecuzione."
}
# llama-server avviati dal progetto (solo quelli dentro la cartella del progetto)
Get-Process llama-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
    Stop-Process -Id $_.Id -Force
    Write-Host "llama-server arrestato (PID $($_.Id))."
}
