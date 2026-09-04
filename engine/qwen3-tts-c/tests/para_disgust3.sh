#!/usr/bin/env bash
# DISGUST v3 — fix the capture method (2026-06-26). LESSON from para_retry: stuffing the source text
# with the sound-WORD (yuck/ugh/grr) makes the model READ the word → contaminates the vector. Laugh
# worked only because "hahaha" IS the laugh sound. For non-onomatopoeic events the source must elicit
# the SPONTANEOUS involuntary sound via a STRONG instruct on text with NO onomatopoeia (like emotion
# capture). Lower weight (w4/w6) to kill the late-layer metallic blow-up. Carrier = NO tag word.
#   -> samples/para_disgust/
set -uo pipefail
cd /Users/gabrielemastrapasqua/source/personal/qwen-tts
O=samples/para_disgust; rm -rf $O; mkdir -p $O
M=qwen3-tts-1.7b; IT=presets/expr/italian_csp_topk6.expr; SEED=42
dur(){ python3 -c "import wave,sys;w=wave.open(sys.argv[1]);print(f'{w.getnframes()/w.getframerate():.2f}s')" "$1" 2>/dev/null||echo FAIL; }
vf(){ case "$1" in galatea) echo "--load-voice voices/galatea_graft.qvoice --icl-only";; *) echo "-s $1";; esac; }
ew(){ [ "$1" = galatea ] && echo 1.0 || echo 1.2; }

# SOURCE: NO onomatopoeia in the text. Strong instruct asks for the involuntary sound.
EV_INS="React with intense physical disgust and revulsion; let involuntary retching and gagging sounds of revulsion escape between the words, recoiling in nausea."
OP_INS="React with warm physical delight and pleasure; let soft involuntary sounds of contentment and satisfaction escape between the words, savoring with deep enjoyment."
SRC_TXT="Oh, look at the state of this thing on the table, it is honestly the most sickening, foul, rotten mess I have ever come across."

# capture both on ryan-EN (neutral-ish text, only the instruct differs)
QWEN_ACT_MAP=$O/_event.qamp ./qwen_tts -d $M -s ryan -l English --seed $SEED -T 1.1 -I "$EV_INS" --text "$SRC_TXT" -o $O/0_SOURCE_event.wav >/dev/null 2>&1
QWEN_ACT_MAP=$O/_opp.qamp   ./qwen_tts -d $M -s ryan -l English --seed $SEED -T 1.1 -I "$OP_INS" --text "$SRC_TXT" -o $O/0_SOURCE_opp.wav   >/dev/null 2>&1
python3 tests/act_map_steer.py $O/_opp.qamp $O/_event.qamp $O/disgust3.qlsteer --unit-per-layer >/dev/null 2>&1
echo "source event $(dur $O/0_SOURCE_event.wav) / opp $(dur $O/0_SOURCE_opp.wav)"

# carrier WITHOUT any onomatopoeia — the vector must ADD the disgust sound as prosody
CARRIER="Guarda in che stato e ridotta questa cosa, e davvero una cosa rivoltante e nauseante."
for sp in galatea vivian; do
  for w in 4 6 8; do
    ./qwen_tts -d $M $(vf $sp) -l Italian --seed $SEED -T 1.1 --expr $IT --expr-weight $(ew $sp) -I "$EV_INS" \
      --ml-steer $O/disgust3.qlsteer --ml-weight $w --ml-range 21-25 --text "$CARRIER" -o $O/${sp}_w${w}.wav >/dev/null 2>&1
    echo "  ${sp}_w${w} -> $(dur $O/${sp}_w${w}.wav)"
  done
done
echo "DONE -> $O"
