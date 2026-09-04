#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=samples/french_ab; mkdir -p "$OUT"
TXT="Bon, laisse-moi t'expliquer calmement comment les choses se passent vraiment."
R32=presets/expr/french_r32.expr; R64=presets/expr/french_r64.expr
C="-l French -T 1.1 --seed 42 -j1 --silent"
declare -A INST=([neutral]="" [sad]="Speak deeply sad and heartbroken, a slow broken voice on the verge of tears." [anger]="Speak with intense, heated, furious anger.")
gen() { if [ -z "$2" ]; then ./qwen_tts $1 $C --text "$TXT" -o "$3" 2>/dev/null; else ./qwen_tts $1 $C --instruct "$2" --text "$TXT" -o "$3" 2>/dev/null; fi; }
echo "### PRESET vivian (base vs +french_r32)"
for e in neutral sad anger; do
  gen "-d qwen3-tts-1.7b -s vivian"             "${INST[$e]}" "$OUT/viv_base_$e.wav"
  gen "-d qwen3-tts-1.7b -s vivian --expr $R32" "${INST[$e]}" "$OUT/viv_r32_$e.wav"
  echo "  viv $e done"
done
echo "### CLONE galatea cross-lingual French (base vs +french_r64)"
GAL="--load-voice voices/galatea_graft.qvoice --icl-only"
for e in sad anger; do
  gen "-d qwen3-tts-1.7b $GAL"             "${INST[$e]}" "$OUT/gal_base_$e.wav"
  gen "-d qwen3-tts-1.7b $GAL --expr $R64" "${INST[$e]}" "$OUT/gal_r64_$e.wav"
  echo "  gal $e done"
done
echo "DONE -> $OUT"
