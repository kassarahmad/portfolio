#!/usr/bin/env bash
# AI Locale - compila stable-diffusion.cpp dentro WSL2, con CUDA.
#
# Serve perche' Smart App Control su Windows rifiuta gli eseguibili non firmati:
# dentro WSL i processi non passano dal controllo di integrita' di Windows.
# I modelli NON si riscaricano: restano su C: e si leggono da /mnt/c.
#
# Uso, da Ubuntu:
#   bash /mnt/c/Users/<tu>/Downloads/ai-locale/ai-locale/scripts/wsl-genera.sh
set -euo pipefail

AIL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$AIL/data/logs/wsl-build.txt"
mkdir -p "$(dirname "$LOG")"
exec > >(tee "$LOG") 2>&1

echo "=== 1/5  La GPU si vede da dentro Linux? ==="
if ! command -v nvidia-smi >/dev/null || ! nvidia-smi -L; then
    echo "  PROBLEMA: nvidia-smi non risponde. Aggiorna il driver NVIDIA su Windows"
    echo "  (il driver NON va installato dentro Ubuntu: WSL lo prende da Windows)."
    exit 1
fi

echo
echo "=== 2/5  Strumenti di compilazione ==="
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential cmake git wget ca-certificates

echo
echo "=== 3/5  CUDA toolkit (circa 3 GB, una volta sola) ==="
if command -v nvcc >/dev/null; then
    echo "  [ok] nvcc gia' presente: $(nvcc --version | tail -1)"
else
    # Repo "wsl-ubuntu" apposta: non installa il driver grafico, che in WSL
    # arriva da Windows e non va mai sovrascritto.
    tmp="$(mktemp -d)"
    if wget -q -O "$tmp/keyring.deb" \
        https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-keyring_1.1-1_all.deb; then
        sudo dpkg -i "$tmp/keyring.deb" >/dev/null
        sudo apt-get update -qq
        sudo apt-get install -y cuda-toolkit || {
            echo "  il pacchetto NVIDIA non e' andato: uso quello di Ubuntu"
            sudo apt-get install -y nvidia-cuda-toolkit
        }
    else
        echo "  repo NVIDIA irraggiungibile: uso il pacchetto di Ubuntu"
        sudo apt-get install -y nvidia-cuda-toolkit
    fi
    rm -rf "$tmp"
    export PATH="/usr/local/cuda/bin:$PATH"
    command -v nvcc >/dev/null || { echo "  PROBLEMA: nvcc non trovato dopo l'installazione"; exit 1; }
fi
export PATH="/usr/local/cuda/bin:$PATH"

echo
echo "=== 4/5  Compilo stable-diffusion.cpp (qualche minuto) ==="
SRC="$HOME/sd-cpp"
if [ -d "$SRC/.git" ]; then
    git -C "$SRC" pull --ff-only && git -C "$SRC" submodule update --init --recursive
else
    git clone --recursive https://github.com/leejet/stable-diffusion.cpp "$SRC"
fi
# CMake 4 (Ubuntu 26.04) rifiuta i progetti che dichiarano una versione minima
# inferiore alla 3.5: la policy sotto li accetta lo stesso.
cmake -S "$SRC" -B "$SRC/build" -DSD_CUDA=ON -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build "$SRC/build" --config Release -j "$(nproc)"

BIN="$(find "$SRC/build" -type f -name 'sd-cli' -perm -u+x | head -1)"
[ -n "$BIN" ] || BIN="$(find "$SRC/build" -type f -name 'sd' -perm -u+x | head -1)"
[ -n "$BIN" ] || { echo "  PROBLEMA: eseguibile non trovato dopo la compilazione"; exit 1; }
echo "  [ok] $BIN"

echo
echo "=== 5/5  Prova vera: genero un'immagine ==="
GEN="$AIL/models/gen"
OUT="$AIL/data/workspace/foto/prova-forno.png"
mkdir -p "$(dirname "$OUT")"
time "$BIN" \
    --diffusion-model "$GEN/diffusion/z_image_turbo-Q4_K.gguf" \
    --vae "$GEN/vae/ae.safetensors" \
    --llm "$GEN/encoder/Qwen3-4B-Instruct-2507-Q4_K_M.gguf" \
    -p "a rustic wood-fired pizza oven with bright flames inside, warm glow on the brick arch, dark pizzeria interior, professional food photography, shallow depth of field" \
    --cfg-scale 1.0 --steps 8 -W 768 -H 1344 --offload-to-cpu --diffusion-fa \
    -o "$OUT" -v

if [ -f "$OUT" ]; then
    # AI Locale legge questo file per sapere come chiamare il motore.
    printf '%s\n' "$BIN" > "$AIL/tools/sd/wsl-path.txt"
    echo
    echo "=== FATTO ==="
    echo "Immagine: $OUT"
    echo "Motore:   $BIN  (scritto in tools/sd/wsl-path.txt)"
else
    echo "  PROBLEMA: l'immagine non e' stata creata. Il log e' in data/logs/wsl-build.txt"
    exit 1
fi
