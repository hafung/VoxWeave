#!/usr/bin/env bash
# Full emotion matrices — k6 IT expr + steering, organized in well-divided folders (2026-06-24).
# Decay 0.985 is now the engine DEFAULT (derail fix always-on) so we don't pass --ml-decay.
# Voices: ryan (preset), vivian (preset, drifts to CN accent), galatea (clone graft).
# Model 1.7b, seed 42, T1.1, Italian. EN vivid instructs. 6 emotions.
set -uo pipefail
cd "$(dirname "$0")/.."
BIN=./qwen_tts; MODEL=qwen3-tts-1.7b; SEED=42; T=1.1
IT=presets/expr/italian_csp_topk6.expr
QL=samples/emo_retest_0622   # ryan_<emo>.qlsteer
GV=voices/galatea_graft.qvoice
dur(){ python3 -c "import wave,sys;w=wave.open(sys.argv[1]);print(f'{w.getnframes()/w.getframerate():.2f}s')" "$1" 2>/dev/null||echo FAIL; }

# emotion -> Italian loaded carrier text
declare -A TXT=(
  [anger]="Come ti permetti di parlarmi così? Questo non lo accetto, è inaccettabile!"
  [sad]="Ho perso tutto quello che avevo, e adesso non so più cosa fare."
  [joy]="Non ci posso credere, è la notizia più bella della mia vita, sono felicissimo!"
  [fear]="C'è qualcuno in casa, ho sentito dei passi... ho paura, non so cosa fare."
  [disgust]="Ma che roba è questa? Fa davvero schifo, non riesco nemmeno a guardarla."
  [surprise]="Cosa?! Non me lo aspettavo per niente, è incredibile, sono sbalordito!"
)
# emotion -> EN vivid instruct
declare -A INS=(
  [anger]="Speak in a furious, seething, enraged tone, voice sharp and hard, barely holding back the rage."
  [sad]="Speak in a sad, sorrowful, gloomy and downcast tone, voice low and heavy, on the verge of tears."
  [joy]="Speak with bright, radiant joy, light and warm, smiling through every word."
  [fear]="Speak in a frightened, trembling, anxious tone, voice shaky and breathless with dread."
  [disgust]="Speak with deep disgust and revulsion, lip-curling contempt, as if something repels you."
  [surprise]="Speak with sudden astonishment and surprise, gasping and caught off guard."
)
EMOS=(anger sad joy fear disgust surprise)
VOICES=(ryan vivian galatea)
# per-voice flags
voice_flags(){ case "$1" in
  ryan)    echo "-s ryan";;
  vivian)  echo "-s vivian";;
  galatea) echo "--load-voice $GV --icl-only";;
esac; }
# per-voice expr-weight (galatea graft likes 1.0, presets 1.2)
exprw(){ [ "$1" = galatea ] && echo 1.0 || echo 1.2; }

gen(){ # gen <outfile> <flags...>
  local out="$1"; shift
  $BIN -d $MODEL -l Italian --seed $SEED -T $T "$@" -o "$out" >/dev/null 2>&1
  echo "  $(basename "$out") -> $(dur "$out")"
}

# ============ FOLDER 1: emo_matrix — voice × emo × {expr-only, steer-only, combine} ============
O=samples/emo_matrix; mkdir -p $O
echo "===== FOLDER 1: emo_matrix (54) ====="
for v in "${VOICES[@]}"; do VF=$(voice_flags $v); EW=$(exprw $v); for e in "${EMOS[@]}"; do
  gen $O/${v}_${e}_expr.wav     $VF --expr $IT --expr-weight $EW -I "${INS[$e]}" --text "${TXT[$e]}"
  gen $O/${v}_${e}_steer.wav    $VF --ml-steer $QL/ryan_${e/anger/ang}.qlsteer --ml-weight 12 --ml-range 21-25 --text "${TXT[$e]}"
  gen $O/${v}_${e}_combine.wav  $VF --expr $IT --expr-weight $EW --ml-steer $QL/ryan_${e/anger/ang}.qlsteer --ml-weight 8 --ml-range 21-25 -I "${INS[$e]}" --text "${TXT[$e]}"
done; done

# ============ FOLDER 2: steer_force — combine at steer-weight {4,8,12} ============
O=samples/steer_force; mkdir -p $O
echo "===== FOLDER 2: steer_force (54) ====="
for v in "${VOICES[@]}"; do VF=$(voice_flags $v); EW=$(exprw $v); for e in "${EMOS[@]}"; do for w in 4 8 12; do
  gen $O/${v}_${e}_w${w}.wav $VF --expr $IT --expr-weight $EW --ml-steer $QL/ryan_${e/anger/ang}.qlsteer --ml-weight $w --ml-range 21-25 -I "${INS[$e]}" --text "${TXT[$e]}"
done; done; done

# ============ FOLDER 3: idea1_grid — expr-weight × steer-weight grid (galatea anger) ============
O=samples/idea1_grid; mkdir -p $O
echo "===== FOLDER 3: idea1_grid galatea anger (8) ====="
for ew in 1.0 1.2; do for sw in 4 6 8 10; do
  gen $O/gal_anger_ew${ew}_sw${sw}.wav --load-voice $GV --icl-only --expr $IT --expr-weight $ew --ml-steer $QL/ryan_ang.qlsteer --ml-weight $sw --ml-range 21-25 -I "${INS[anger]}" --text "${TXT[anger]}"
done; done
echo "===== matrices DONE ====="
