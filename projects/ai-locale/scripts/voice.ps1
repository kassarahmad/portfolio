#Requires -Version 5.1
<#
  AI Locale - installa la voce: trascrizione (faster-whisper) e voce italiana (Piper).
  Uso: powershell -ExecutionPolicy Bypass -File scripts\voice.ps1
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$VPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $VPy)) { Write-Host "Esegui prima scripts\setup.ps1" -ForegroundColor Yellow; exit 1 }

Write-Host "`n=== Librerie per la voce ===" -ForegroundColor Cyan
& $VPy -m pip install "faster-whisper>=1.1" "piper-tts>=1.2" --quiet --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { Write-Host "  [!] Installazione non riuscita" -ForegroundColor Yellow; exit 1 }
Write-Host "  [ok] faster-whisper e piper-tts" -ForegroundColor Green

Write-Host "`n=== Voce italiana (Piper, Paola) ===" -ForegroundColor Cyan
$dir = Join-Path $Root "models\voices"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$hf = "https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium"
foreach ($f in "it_IT-paola-medium.onnx", "it_IT-paola-medium.onnx.json") {
    $dest = Join-Path $dir $f
    if (Test-Path $dest) { Write-Host "  [ok] $f gia' presente" -ForegroundColor Green; continue }
    & curl.exe -L --fail --retry 5 -o "$dest.part" "$hf/$f"
    if ($LASTEXITCODE -ne 0) { Write-Host "  [!] Download non riuscito: $f" -ForegroundColor Yellow; exit 1 }
    Move-Item -Force "$dest.part" $dest
    Write-Host "  [ok] $f" -ForegroundColor Green
}

Write-Host "`n=== Modello di trascrizione (Whisper small, ~470 MB, una volta sola) ===" -ForegroundColor Cyan
& $VPy -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8'); print('  [ok] Whisper pronto')"

Write-Host "`n=== Prova della voce ===" -ForegroundColor Cyan
& $VPy -c "import wave; from piper import PiperVoice; v=PiperVoice.load(r'$dir\it_IT-paola-medium.onnx'); w=wave.open(r'$dir\prova.wav','wb'); (v.synthesize_wav if hasattr(v,'synthesize_wav') else v.synthesize)('Ciao, sono AI Locale. La voce funziona.', w); w.close(); print('  [ok] creato models\\voices\\prova.wav')"
Write-Host "`nVoce installata. Riavvia AI Locale (stop.ps1 e start.ps1)." -ForegroundColor Green
