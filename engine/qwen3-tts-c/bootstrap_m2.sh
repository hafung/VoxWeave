#!/usr/bin/env bash
# bootstrap_m2.sh — ONE script to take a FRESH Apple Silicon box (Scaleway Mac mini M2/M4)
# from zero → full native build → both benches. Run it with a single curl on the bare box:
#
#     curl -fsSL https://raw.githubusercontent.com/gabriele-mastrapasqua/qwen3-tts/feat/gpu-backends/bootstrap_m2.sh | bash
#
# (curl is part of base macOS — no git/compiler needed to START; this script installs them.)
#
# What it does:
#   1. install Command Line Tools (git + make + clang + Metal SDK) — headless, no GUI popup
#   2. clone/pull this public repo @ feat/gpu-backends
#   3. download the 0.6B + 1.7B CustomVoice models (curl from HF CDN — fast on the box's link)
#   4. build NATIVE (make metal CC=clang) → true M2/M4 CPU (i8mm/bf16) + Metal
#   5. run bench_m2.sh → BOTH benches: CPU (M2 vs our M1 numbers) AND Metal M2 GPU
#
# Env knobs:  WITH_BREW=1 (also install Homebrew — NOT required for the build) ·
#             RUN_BENCH=0 (stop after build) · WORKDIR=<path> (default ~/qwen-tts) ·
#             SKIP_MODELS=1
set -eu

REPO_URL=${REPO_URL:-https://github.com/gabriele-mastrapasqua/qwen3-tts.git}
BRANCH=${BRANCH:-feat/gpu-backends}
WORKDIR=${WORKDIR:-$HOME/qwen-tts}

echo "════════════════════════════════════════════════════════════════════"
echo " bootstrap_m2 — fresh-box → native build → bench"
echo " host: $(uname -srm)"
command -v sysctl >/dev/null && echo " chip: $(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
echo "════════════════════════════════════════════════════════════════════"

# ── 1. Command Line Tools (git/make/clang/Metal SDK), headless-safe ───────────────────────────────
if ! xcode-select -p >/dev/null 2>&1 || ! /usr/bin/xcrun --find clang >/dev/null 2>&1; then
  echo "── [1/5] installing Command Line Tools (headless) ──"
  FLAG=/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
  sudo touch "$FLAG"
  # Robust across macOS versions: pick the highest 'Command Line Tools' label softwareupdate lists.
  PROD=$(softwareupdate -l 2>/dev/null | grep -E 'Label: *Command Line Tools' \
          | sed -E 's/.*Label: *//' | sort -V | tail -1)
  if [ -n "${PROD:-}" ]; then
    echo "   installing: $PROD"
    sudo softwareupdate -i "$PROD" --verbose || true
  fi
  sudo rm -f "$FLAG" || true
  xcode-select -p >/dev/null 2>&1 || sudo xcode-select --switch /Library/Developer/CommandLineTools 2>/dev/null || true
  if ! /usr/bin/xcrun --find clang >/dev/null 2>&1; then
    echo "!! CLT install did not complete non-interactively."
    echo "   Open the box's VNC/console once and run:  xcode-select --install"
    echo "   then re-run this script. (Many Scaleway images ship CLT/Xcode already.)"
    exit 1
  fi
fi
echo "   CLT ok: $(xcode-select -p)  ·  clang $(clang --version | head -1)"

# ── 1b. Homebrew (OPTIONAL — the build does NOT need it; system Accelerate/Metal only) ────────────
if [ "${WITH_BREW:-0}" = "1" ] && ! command -v brew >/dev/null 2>&1; then
  echo "── installing Homebrew (optional) ──"
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || \
    echo "   (brew install skipped/failed — not required, continuing)"
fi

# ── 2. clone / pull the repo ──────────────────────────────────────────────────────────────────────
echo "── [2/5] fetch repo @ $BRANCH → $WORKDIR ──"
if [ -d "$WORKDIR/.git" ]; then
  git -C "$WORKDIR" fetch --depth 1 origin "$BRANCH"
  git -C "$WORKDIR" checkout "$BRANCH"
  git -C "$WORKDIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$WORKDIR"
fi
cd "$WORKDIR"
echo "   at $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

# ── 3. models (0.6B + 1.7B CustomVoice) from HF CDN ───────────────────────────────────────────────
if [ "${SKIP_MODELS:-0}" != "1" ]; then
  echo "── [3/5] download models (curl from HF CDN) ──"
  chmod +x download_model.sh
  [ -d qwen3-tts-0.6b ] || ./download_model.sh --model small
  [ -d qwen3-tts-1.7b ] || ./download_model.sh --model large
fi

# ── 4. native Metal build ─────────────────────────────────────────────────────────────────────────
echo "── [4/5] make metal CC=clang (native → M2/M4 CPU i8mm/bf16 + Metal) ──"
make metal CC=clang
echo "── build ok. compiled caps: ──"
./qwen_tts --caps 2>&1 | grep -iE "runtime cpu|lever|note:" || true

# ── 5. run both benches ───────────────────────────────────────────────────────────────────────────
if [ "${RUN_BENCH:-1}" = "1" ]; then
  echo "── [5/5] running bench_m2.sh (CPU + Metal, full RTF matrix) ──"
  chmod +x bench_m2.sh
  ./bench_m2.sh
  echo ""
  echo "✅ DONE. Send back:   cat $WORKDIR/bench_out/summary_*.txt"
else
  echo "✅ build done (RUN_BENCH=0). Bench with:  cd $WORKDIR && ./bench_m2.sh"
fi
