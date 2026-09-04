#!/usr/bin/env bash
# setup_m2.sh — bootstrap a FRESH rented Apple Silicon box (Scaleway Mac mini, etc.).
#
# Two ways to bench on the box (see bench_m2.sh header):
#   PATH A (fast, recommended for GPU):  scp a prebuilt M1 Metal binary → no compiler needed.
#       On the box:  git clone <repo> && cd && git checkout feat/gpu-backends
#                    ( scp the ./qwen_tts binary from your Mac into this dir )
#                    SKIP_BUILD=1 ./setup_m2.sh      # just fetches the CV models
#                    ./bench_m2.sh
#   PATH B (native, for TRUE M2/M4 CPU i8mm/bf16 numbers):
#       On the box:  git clone <repo> && cd && git checkout feat/gpu-backends
#                    ./setup_m2.sh                    # CLT + models + make metal
#                    ./bench_m2.sh
#
# Env: SKIP_BUILD=1 (skip compiler+build, path A) · SKIP_MODELS=1 (models already present)
set -eu

echo "── setup_m2: bootstrapping $(uname -srm) ──"
command -v sysctl >/dev/null && sysctl -n machdep.cpu.brand_string 2>/dev/null

# ── 1. Xcode Command Line Tools (clang + Metal SDK), headless-safe ────────────────────────────────
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    echo "── installing Command Line Tools (headless) ──"
    # Trick: create the on-demand flag so `softwareupdate` lists the CLT non-interactively.
    sudo touch /Library/Developer/CommandLineTools 2>/dev/null || true
    FLAG=/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
    sudo touch "$FLAG"
    PROD=$(softwareupdate -l 2>/dev/null \
            | grep -E 'Command Line Tools' | tail -1 \
            | sed -E 's/^[^C]*Label: *//; s/^\* *Label: *//' | tr -d '\n')
    if [ -n "${PROD:-}" ]; then
      echo "   installing: $PROD"
      sudo softwareupdate -i "$PROD" --verbose || true
    fi
    sudo rm -f "$FLAG" || true
    if ! xcode-select -p >/dev/null 2>&1; then
      echo "!! CLT still missing. Fall back to: xcode-select --install (may need a GUI/VNC session),"
      echo "   or use PATH A (scp the prebuilt binary + SKIP_BUILD=1 ./setup_m2.sh)."
      exit 1
    fi
  fi
  echo "   CLT: $(xcode-select -p)"
fi

# ── 2. CV models (small=0.6B, large=1.7B) from HuggingFace — fast on the box's 1 Gbps link ────────
if [ "${SKIP_MODELS:-0}" != "1" ]; then
  [ -d qwen3-tts-0.6b ] || { echo "── download 0.6B CustomVoice ──"; ./download_model.sh --model small; }
  [ -d qwen3-tts-1.7b ] || { echo "── download 1.7B CustomVoice ──"; ./download_model.sh --model large; }
fi

# ── 3. native Metal build (path B) ────────────────────────────────────────────────────────────────
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "── make metal CC=clang ──"
  make metal CC=clang
  echo "── native build done. --caps: ──"
  ./qwen_tts --caps 2>&1 | grep -iE "note:|lever" || true
else
  echo "── SKIP_BUILD=1: expecting an scp'd ./qwen_tts binary ──"
  [ -x ./qwen_tts ] && ./qwen_tts --caps 2>&1 | grep -iE "note:|lever" || echo "!! ./qwen_tts not found — scp it here first."
fi

echo ""
echo "✅ setup done. Now run:  ./bench_m2.sh"
