#!/usr/bin/env python3
# Build train_raw.jsonl for the Korean .expr LoRA from EmotionTTS Open DB (ETOD).
# Sibling of prepare_manifest.py — ETOD ships as on-disk WAV + per-clip transcript .txt, with the
# emotion encoded in the filename NUMBER RANGE (not a folder), so it gets its own loader. Output
# schema is IDENTICAL to prepare_manifest.py (audio/text/ref_audio/instruct/emotion), so the
# downstream pipeline (prepare_data.py -> train_lora.py -> export_expr.py) is unchanged.
#
# DATA: clone github.com/emotiontts/emotiontts_open_db (the repo holds the 5% public sample, ~300
# clips; the full ~6,000-clip set is via the Google-form in Dataset/SpeechCorpus/Emotional/README.md).
# Point --root at the cloned repo (or any dir containing the Emotional/ tree).
#
# LICENSE: CC-BY-NC-SA-4.0 (research, NON-commercial). We don't redistribute the data, only train a
# micro-LoRA -> OK to USE; do not ship the data. See DATASETS.md.
#
# ETOD emotion = filename range per speaker (e.g. emaNNNNN):
#   00001-00100 일반 neutral | 00101-00200 기쁨 happy | 00201-00300 화남 angry | 00301-00400 슬픔 sad
# WAV: PCM 16-bit, 22.05 kHz mono -> resampled up to 24 kHz.
import argparse, glob, json, os, re
from collections import Counter
import librosa, soundfile as sf

# Korean emotion -> vivid ENGLISH instruct (instruct-following is EN/ZH-centric; speech stays Korean).
# neutral -> "" anchors the no-instruct case, like prepare_manifest.py.
EMOTION_INSTRUCT = {
    "neutral": "",
    "happy":   "Speak happily, bright and warm, smiling through the words.",
    "angry":   "Speak with hot, furious anger, sharp and forceful.",
    "sad":     "Speak with a sad, sorrowful, downcast tone, voice low and heavy.",
}

def emo_from_num(n):
    if   1   <= n <= 100: return "neutral"
    elif 101 <= n <= 200: return "happy"
    elif 201 <= n <= 300: return "angry"
    elif 301 <= n <= 400: return "sad"
    return None

_NAME = re.compile(r"^([a-z]+)(\d{5})$")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="ETOD repo dir (contains Dataset/SpeechCorpus/Emotional)")
    ap.add_argument("--out_dir", default="data_etod")
    ap.add_argument("--histogram", action="store_true")
    args = ap.parse_args()

    wavs = sorted(glob.glob(os.path.join(args.root, "**", "Emotional", "**", "*.wav"), recursive=True))
    if not wavs:
        ap.error(f"no Emotional/**/*.wav under {args.root} (clone emotiontts_open_db and point --root at it)")

    if args.histogram:
        c = Counter()
        for w in wavs:
            m = _NAME.match(os.path.basename(w)[:-4])
            if m: c[emo_from_num(int(m.group(2)))] += 1
        print("ETOD emotion counts:", dict(c), "| total wav:", len(wavs))
        return

    wav_dir = os.path.join(args.out_dir, "wav24k"); os.makedirs(wav_dir, exist_ok=True)
    out_jsonl = os.path.join(args.out_dir, "train_raw.jsonl")
    rows, skipped = [], 0
    for w in wavs:
        base = os.path.basename(w)[:-4]
        m = _NAME.match(base)
        if not m: skipped += 1; continue
        emo = emo_from_num(int(m.group(2)))
        if emo not in EMOTION_INSTRUCT: skipped += 1; continue
        # transcript: sibling transcript/<base>.txt (strip UTF-8 BOM); fall back to script/.
        txt = None
        for sub in ("transcript", "script"):
            tp = os.path.join(os.path.dirname(os.path.dirname(w)), sub, base + ".txt")
            if os.path.exists(tp):
                txt = open(tp, encoding="utf-8-sig").read().strip(); break
        if not txt: skipped += 1; continue
        out = os.path.join(wav_dir, base + ".wav")
        if not os.path.exists(out):
            y, sr = librosa.load(w, sr=24000, mono=True)
            sf.write(out, y, 24000, subtype="PCM_16")
        rows.append({"audio": out, "text": txt, "ref_audio": out,
                     "instruct": EMOTION_INSTRUCT[emo], "emotion": emo})

    with open(out_jsonl, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} rows (skipped {skipped}) -> {out_jsonl}")
    print("emotions:", dict(Counter(r["emotion"] for r in rows)))
    print("NEXT: prepare_data.py -> audio_codes, then train_lora.py --layers 0-27 r32. See DATASETS.md.")

if __name__ == "__main__":
    main()
