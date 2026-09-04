#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=samples/spanish_ab; mkdir -p "$OUT"
TXT="Bueno, dejame explicarte con calma como estan realmente las cosas."
R32=presets/expr/spanish_r32.expr; R64=presets/expr/spanish_r64.expr
C="-l Spanish -T 1.1 --seed 42 -j1 --silent"
declare -A INST=([neutral]="" [sad]="Speak deeply sad and heartbroken, a slow broken voice on the verge of tears." [anger]="Speak with intense, heated, furious anger.")
gen() { if [ -z "$2" ]; then ./qwen_tts $1 $C --text "$TXT" -o "$3" 2>/dev/null; else ./qwen_tts $1 $C --instruct "$2" --text "$TXT" -o "$3" 2>/dev/null; fi; }
echo "### PRESET vivian (base vs +spanish_r32)"
for e in neutral sad anger; do
  gen "-d qwen3-tts-1.7b -s vivian"             "${INST[$e]}" "$OUT/viv_base_$e.wav"
  gen "-d qwen3-tts-1.7b -s vivian --expr $R32" "${INST[$e]}" "$OUT/viv_r32_$e.wav"
  echo "  viv $e done"
done
echo "### CLONE galatea cross-lingual Spanish (base vs +spanish_r64)"
GAL="--load-voice voices/galatea_graft.qvoice --icl-only"
for e in sad anger; do
  gen "-d qwen3-tts-1.7b $GAL"             "${INST[$e]}" "$OUT/gal_base_$e.wav"
  gen "-d qwen3-tts-1.7b $GAL --expr $R64" "${INST[$e]}" "$OUT/gal_r64_$e.wav"
  echo "  gal $e done"
done
echo "DONE -> $OUT"
