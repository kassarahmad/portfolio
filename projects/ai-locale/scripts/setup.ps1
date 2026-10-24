#Requires -Version 5.1
<#
  AI Locale - installazione guidata per Windows 10/11.

  Cosa fa (chiedendo conferma prima di ogni download):
    1. Audit: Python, GPU NVIDIA, driver, VRAM, RAM, disco
    2. Ambiente Python (.venv) e dipendenze
    3. File di configurazione .env
    4. llama.cpp (llama-server con supporto CUDA) dall'ultima release ufficiale
    5. Modello chat + modello embedding adatti alla tua VRAM
    6. Test automatici

  Uso:   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
  Opzioni: -SkipLlama  -SkipModels  -Yes (risponde si a tutto)
#>
param([switch]$SkipLlama, [switch]$SkipModels, [switch]$Yes)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  [ok] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Ask($q) {
    if ($Yes) { return $true }
    $r = Read-Host "  $q [s/N]"
    return ($r -match '^(s|si|y|yes)$')
}
function Set-EnvValue($key, $value) {
    $path = Join-Path $Root ".env"
    $lines = @(Get-Content $path -Encoding UTF8)
    $found = $false
    $out = @(foreach ($l in $lines) {
        if ($l -match "^$key=") { $found = $true; "$key=$value" } else { $l }
    })
    if (-not $found) { $out += "$key=$value" }
    [System.IO.File]::WriteAllLines($path, [string[]]$out, (New-Object System.Text.UTF8Encoding($false)))
}
function Download($url, $dest) {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & curl.exe -L --fail --retry 3 -C - -o $dest $url
        if ($LASTEXITCODE -ne 0) { throw "Download fallito: $url" }
    } else {
        Start-BitsTransfer -Source $url -Destination $dest
    }
}

# ---------------------------------------------------------------- 1. Audit
Step "1. Audit del sistema"
$py = $null
foreach ($cand in @(@("py", "-3.12"), @("py", "-3.11"), @("py", "-3.13"), @("python"))) {
    try {
        $exe = $cand[0]; $rest = @($cand | Select-Object -Skip 1)
        $v = & $exe @rest -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -eq 0 -and $v -and ([version]$v -ge [version]"3.11")) { $py = $cand; Ok "Python $v ($($cand -join ' '))"; break }
    } catch { }
}
if (-not $py) {
    Warn "Python 3.11+ non trovato. Installalo da https://www.python.org/downloads/ (spunta 'Add to PATH') e rilancia."
    exit 1
}

$vramGB = 0
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($smi) {
    $info = (& nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits) -split "`n" | Select-Object -First 1
    $parts = $info -split ","
    $vramGB = [math]::Round([double]$parts[1].Trim() / 1024, 1)
    Ok "GPU: $($parts[0].Trim()) - VRAM $vramGB GB - driver $($parts[2].Trim())"
    $smiHeader = (& nvidia-smi) -join "`n"
    if ($smiHeader -match "CUDA Version:\s*([\d.]+)") { Ok "Versione CUDA massima supportata dal driver: $($Matches[1])" }
} else {
    Warn "nvidia-smi non trovato: installa/aggiorna il driver NVIDIA (https://www.nvidia.com/drivers). Senza GPU i modelli useranno la CPU."
}
$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$drive = (Get-Item $Root).PSDrive
$freeGB = [math]::Round($drive.Free / 1GB, 0)
Ok "RAM: $ramGB GB - Disco $($drive.Name): $freeGB GB liberi"
if ($freeGB -lt 15) { Warn "Spazio su disco scarso: servono circa 7 GB per modelli e llama.cpp." }

# ---------------------------------------------------------------- 2. Python
Step "2. Ambiente Python (.venv)"
$VPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $VPy)) {
    $exe = $py[0]; $rest = @($py | Select-Object -Skip 1)
    & $exe @rest -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Creazione .venv fallita" }
    Ok "Creato .venv"
} else { Ok ".venv esistente" }
& $VPy -m pip install --upgrade pip --quiet
& $VPy -m pip install -r requirements.txt --quiet
if ($LASTEXITCODE -ne 0) { throw "Installazione dipendenze fallita" }
Ok "Dipendenze installate"

# ---------------------------------------------------------------- 3. .env
Step "3. Configurazione"
if (-not (Test-Path (Join-Path $Root ".env"))) {
    Copy-Item .env.example .env
    Ok "Creato .env da .env.example"
} else { Ok ".env esistente (non modificato salvo le voci di llama.cpp e modelli)" }
New-Item -ItemType Directory -Force -Path models, tools, data | Out-Null

# ---------------------------------------------------------------- 4. llama.cpp
Step "4. Motore llama.cpp (llama-server)"
$serverExe = Get-ChildItem -Path (Join-Path $Root "tools") -Recurse -Filter "llama-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($serverExe) { Ok "Trovato $($serverExe.FullName)" }
if (-not $SkipLlama -and (-not $serverExe -or (Ask "Vuoi aggiornare llama.cpp all'ultima versione?"))) {
    try {
        $rel = Invoke-RestMethod "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest" -Headers @{ "User-Agent" = "ailocale-setup" }
        $cands = @()
        foreach ($a in $rel.assets) {
            if ($a.name -match '^cudart') { continue }
            if ($a.name -match 'win' -and $a.name -match 'cuda' -and $a.name -match 'x64' -and $a.name -match '\.zip$' -and $a.name -match 'cuda-?(\d+(\.\d+)?)') {
                $cands += [pscustomobject]@{ Asset = $a; Ver = [version]($Matches[1] + $(if ($Matches[1] -notmatch '\.') { ".0" } else { "" })); VerText = $Matches[1] }
            }
        }
        if ($cands.Count -eq 0) {
            Warn "Nessun pacchetto Windows CUDA trovato nella release $($rel.tag_name)."
            Warn "Scaricalo a mano da https://github.com/ggml-org/llama.cpp/releases, estrailo in tools\llama.cpp e rilancia."
        } else {
            $best = $cands | Sort-Object Ver -Descending | Select-Object -First 1
            Write-Host "  Release $($rel.tag_name): $($best.Asset.name) ($([math]::Round($best.Asset.size/1MB)) MB)"
            if ($best.Ver -lt [version]"12.8") { Warn "Le GPU RTX 50 (Blackwell) richiedono CUDA 12.8 o superiore: questo pacchetto potrebbe non funzionare." }
            if (Ask "Scaricare e installare llama.cpp in tools\llama.cpp?") {
                $dir = Join-Path $Root "tools\llama.cpp"
                New-Item -ItemType Directory -Force -Path $dir | Out-Null
                $zip = Join-Path $env:TEMP $best.Asset.name
                Download $best.Asset.browser_download_url $zip
                Expand-Archive -Path $zip -DestinationPath $dir -Force
                $cudart = $rel.assets | Where-Object { $_.name -match '^cudart' -and $_.name -match 'win' -and $_.name -match [regex]::Escape($best.VerText) } | Select-Object -First 1
                if ($cudart) {
                    $zip2 = Join-Path $env:TEMP $cudart.name
                    Download $cudart.browser_download_url $zip2
                    Expand-Archive -Path $zip2 -DestinationPath $dir -Force
                    Ok "Librerie CUDA runtime installate ($($cudart.name))"
                }
                $serverExe = Get-ChildItem -Path $dir -Recurse -Filter "llama-server.exe" | Select-Object -First 1
                Ok "llama-server: $($serverExe.FullName)"
            }
        }
    } catch {
        Warn "Impossibile scaricare llama.cpp: $($_.Exception.Message)"
    }
}
if ($serverExe) { Set-EnvValue "LLAMA_SERVER_PATH" $serverExe.FullName }

# ---------------------------------------------------------------- 5. Modelli
Step "5. Modelli"
# Modello principale MULTIMODALE: ragiona, usa gli strumenti e vede le immagini (testo + visione)
$hf = "https://huggingface.co/Qwen"
if ($vramGB -ge 7 -or $vramGB -eq 0) {
    $chat = @{ File = "Qwen3VL-8B-Instruct-Q4_K_M.gguf"; Url = "$hf/Qwen3-VL-8B-Instruct-GGUF/resolve/main/Qwen3VL-8B-Instruct-Q4_K_M.gguf"; Size = "~5.0 GB" }
    $mmproj = @{ File = "mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf"; Url = "$hf/Qwen3-VL-8B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf"; Size = "~750 MB" }
} else {
    $chat = @{ File = "Qwen3VL-4B-Instruct-Q4_K_M.gguf"; Url = "$hf/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf"; Size = "~2.5 GB" }
    $mmproj = @{ File = "mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf"; Url = "$hf/Qwen3-VL-4B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf"; Size = "~450 MB" }
}
$embed = @{ File = "nomic-embed-text-v1.5.Q8_0.gguf"; Url = "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf"; Size = "~146 MB" }
if (-not $SkipModels) {
    foreach ($m in @(@{ Kind = "CHAT_MODEL_FILE"; M = $chat }, @{ Kind = "CHAT_MMPROJ_FILE"; M = $mmproj }, @{ Kind = "EMBED_MODEL_FILE"; M = $embed })) {
        $dest = Join-Path $Root ("models\" + $m.M.File)
        if (Test-Path $dest) { Ok "$($m.M.File) gia' presente"; Set-EnvValue $m.Kind $m.M.File; continue }
        if (Ask "Scaricare $($m.M.File) ($($m.M.Size))?") {
            Download $m.M.Url $dest
            Ok "Scaricato $($m.M.File)"
            Set-EnvValue $m.Kind $m.M.File
        }
    }
}
Set-EnvValue "LLAMA_AUTOSTART" "true"

# ---------------------------------------------------------------- 5b. Browser e OCR
Step "5b. Browser automatico e OCR"
if (Ask "Installare Chromium per il browser automatico dell'agente Navigatore (~150 MB)?") {
    & $VPy -m playwright install chromium
    if ($LASTEXITCODE -eq 0) { Ok "Chromium installato" } else { Warn "Installazione di Chromium non riuscita" }
}
$tess = (Get-Command tesseract -ErrorAction SilentlyContinue) -or (Test-Path "C:\Program Files\Tesseract-OCR\tesseract.exe")
if ($tess) { Ok "Tesseract OCR presente" }
elseif ((Get-Command winget -ErrorAction SilentlyContinue) -and (Ask "Installare Tesseract OCR (lettura veloce di PDF scansionati) con winget?")) {
    winget install --id UB-Mannheim.TesseractOCR -e --accept-package-agreements --accept-source-agreements
    Warn "Per l'italiano copia ita.traineddata in C:\Program Files\Tesseract-OCR\tessdata (vedi README). Senza Tesseract l'OCR usa il modello di visione."
} else { Warn "Tesseract non installato: l'OCR usera' il modello di visione (piu' lento)." }

# ---------------------------------------------------------------- 6. Test
Step "6. Verifica"
& $VPy -m backend.app.cli audit
if (Ask "Eseguire i test automatici?") {
    & $VPy -m unittest discover -s tests
    if ($LASTEXITCODE -eq 0) { Ok "Tutti i test superati" } else { Warn "Alcuni test sono falliti: controlla l'output sopra." }
}

Write-Host "`nInstallazione completata. Avvia con:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1" -ForegroundColor Green
