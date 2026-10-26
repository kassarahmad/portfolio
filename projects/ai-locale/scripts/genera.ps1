#Requires -Version 5.1
<#
  AI Locale - generazione locale di immagini e video (stable-diffusion.cpp).
  Scarica il motore e i modelli: tutto gira sul PC, nessun servizio esterno.
  Uso: powershell -ExecutionPolicy Bypass -File scripts\genera.ps1 [-SoloImmagini]

  Lo script si puo' rilanciare: i download riprendono da dove erano rimasti
  e i file gia' presenti e completi non vengono riscaricati.
#>
param([switch]$SoloImmagini, [switch]$SoloVideo)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Gen    = Join-Path $Root "tools\sd"
$Models = Join-Path $Root "models\gen"
New-Item -ItemType Directory -Force -Path $Gen, "$Models\diffusion", "$Models\vae", "$Models\encoder" | Out-Null

function Download($url, $dest, $attesi) {
    if ((Test-Path $dest) -and ($attesi -eq 0 -or (Get-Item $dest).Length -eq $attesi)) {
        Write-Host ("  [ok] " + (Split-Path $dest -Leaf) + " gia' presente"); return
    }
    $gb = [math]::Round($attesi / 1GB, 2)
    Write-Host ("  scarico " + (Split-Path $dest -Leaf) + $(if ($attesi) { " ($gb GB)" } else { "" })) -ForegroundColor Cyan
    $part = "$dest.part"
    & curl.exe -L --fail --retry 5 --retry-delay 3 -C - -o $part $url
    if ($LASTEXITCODE -ne 0) { throw "Download fallito: $url  (rilancia lo script per riprendere)" }
    Move-Item -Force $part $dest
    if ($attesi -and (Get-Item $dest).Length -ne $attesi) {
        Remove-Item $dest -Force
        throw "Il file scaricato non ha la dimensione attesa: riprova."
    }
}

# ---------------------------------------------------------------- motore
Write-Host "`n=== Motore: stable-diffusion.cpp (CUDA) ===" -ForegroundColor Cyan
if (Test-Path (Join-Path $Gen "sd-cli.exe")) {
    Write-Host "  [ok] sd-cli.exe gia' presente"
} else {
    $rel = Invoke-RestMethod "https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest" `
                             -Headers @{ "User-Agent" = "ai-locale" }
    $bin = $rel.assets | Where-Object { $_.name -match "win-cuda\d*-x64\.zip$" } | Select-Object -First 1
    $cud = $rel.assets | Where-Object { $_.name -match "^cudart-.*win.*\.zip$" }  | Select-Object -First 1
    if (-not $bin) { throw "Nessun pacchetto Windows CUDA nella release $($rel.tag_name)" }
    Write-Host "  release $($rel.tag_name)"
    $tmp = Join-Path $env:TEMP ("sd-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    Download $bin.browser_download_url (Join-Path $tmp $bin.name) $bin.size
    Expand-Archive -Path (Join-Path $tmp $bin.name) -DestinationPath $tmp -Force
    if ($cud) {
        Download $cud.browser_download_url (Join-Path $tmp $cud.name) $cud.size
        Expand-Archive -Path (Join-Path $tmp $cud.name) -DestinationPath $tmp -Force
    }
    Get-ChildItem $tmp -Recurse -Include *.exe, *.dll | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $Gen $_.Name) -Force
    }
    Remove-Item $tmp -Recurse -Force
    if (-not (Test-Path (Join-Path $Gen "sd-cli.exe"))) { throw "sd-cli.exe non trovato nel pacchetto" }
    Write-Host "  [ok] motore installato in tools\sd"
}

# ---------------------------------------------------------------- immagini
$HF = "https://huggingface.co"
if (-not $SoloVideo) {
    Write-Host "`n=== Immagini: Z-Image Turbo (circa 6.7 GB, una volta sola) ===" -ForegroundColor Cyan
    Download "$HF/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf" `
             "$Models\diffusion\z_image_turbo-Q4_K.gguf" 3864250304
    # Stesso identico file del repo di FLUX (335.304.388 byte), ma senza login:
    # black-forest-labs/FLUX.1-schnell risponde 401 a chi non e' autenticato.
    Download "$HF/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" `
             "$Models\vae\ae.safetensors" 335304388
    Download "$HF/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf" `
             "$Models\encoder\Qwen3-4B-Instruct-2507-Q4_K_M.gguf" 2497281120
}

# ---------------------------------------------------------------- video
if (-not $SoloImmagini) {
    Write-Host "`n=== Video: Wan 2.2 TI2V-5B (circa 9.8 GB, una volta sola) ===" -ForegroundColor Cyan
    Download "$HF/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q6_K.gguf" `
             "$Models\diffusion\Wan2.2-TI2V-5B-Q6_K.gguf" 4211683680
    Download "$HF/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors" `
             "$Models\vae\wan2.2_vae.safetensors" 1409400960
    Download "$HF/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q5_K_M.gguf" `
             "$Models\encoder\umt5-xxl-encoder-Q5_K_M.gguf" 4145878880
}

Write-Host "`n=== Riepilogo ===" -ForegroundColor Cyan
Get-ChildItem $Models -Recurse -File | ForEach-Object {
    "{0,-46} {1,8:N2} GB" -f $_.Name, ($_.Length / 1GB)
}
Write-Host "`nFatto. Riavvia AI Locale (RIAVVIA.bat) e il Montatore avra' i suoi strumenti." -ForegroundColor Green
