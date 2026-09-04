#!/usr/bin/env bash
# RE-VALIDATE the two paralinguistic methods (user 2026-06-24):
#   METHOD 1 = MACRO composer (tag -> synth onomatopoeia span, no train): just put [tag] in --text (auto-routes).
#   METHOD 2 = paralinguistic .expr LoRA (model emits a REAL event from the inline tag): --no-compose + --expr.
# Past verdict: [sigh] worked (LoRA > macro), [laugh] failed (read literally), ep8 over-forced. aug = the
# cross-lingual augmentation (VocalSound spliced into multilingual carriers). ryan 1.7B, IT, T1.1, seed42.
set -uo pipefail
cd "$(dirname "$0")/.."
O=samples/paraling_reval; mkdir -p $O
AUG=presets/expr/paralinguistic_aug.expr
EP2=presets/expr/paralinguistic_ep2.expr
dur(){ python3 -c "import wave,sys;w=wave.open(sys.argv[1]);print(f'{w.getnframes()/w.getframerate():.2f}s')" "$1" 2>/dev/null||echo FAIL; }
base="-d qwen3-tts-1.7b -s ryan -l Italian --seed 42 -T 1.1"
macro(){ local o="$1" t="$2"; ./qwen_tts $base --text "$t" -o $O/$o >/dev/null 2>&1; echo "  $o -> $(dur $O/$o)"; }
lora(){  local o="$1" t="$2" expr="$3" w="$4"; ./qwen_tts $base --no-compose --expr "$expr" --expr-weight "$w" --text "$t" -o $O/$o >/dev/null 2>&1; echo "  $o -> $(dur $O/$o)"; }

echo "===== [sigh] — methods 1 vs 2 ====="
S="Sono davvero stanco oggi [sigh] non ce la faccio più."
macro sigh_M1_macro.wav       "$S"
lora  sigh_M2_aug_w1.0.wav     "$S" $AUG 1.0
lora  sigh_M2_aug_w0.6.wav     "$S" $AUG 0.6
lora  sigh_M2_ep2_w1.0.wav     "$S" $EP2 1.0

echo "===== [laugh] — the one that FAILED before; does aug fix it? ====="
L="Che bella notizia [laugh] non ci posso credere!"
macro laugh_M1_macro.wav      "$L"
lora  laugh_M2_aug_w1.0.wav    "$L" $AUG 1.0
lora  laugh_M2_aug_w0.6.wav    "$L" $AUG 0.6
lora  laugh_M2_ep2_w1.0.wav    "$L" $EP2 1.0

echo "===== [breath] — LoRA-only (macro has no breath) ====="
B="Aspetta un attimo [breath] lasciami pensare."
lora  breath_M2_aug_w1.0.wav   "$B" $AUG 1.0
lora  breath_M2_aug_w0.6.wav   "$B" $AUG 0.6
echo "===== DONE ====="
