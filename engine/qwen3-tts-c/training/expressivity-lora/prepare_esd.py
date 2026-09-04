#!/usr/bin/env python3
"""ESD (Emotional Speech Dataset, Zhou et al.) -> train_raw.jsonl in the SAME schema as EMOVO
(gpu_emovo_prep.py), so multi-speaker ESD aligns ALONGSIDE EMOVO for a voice-agnostic, multi-speaker
emotion fine-tune (the deep-research lever: emotion learned across MANY identities -> generalizes to
cloned/novel x-vectors). See docs/emotion-research.md, PLAN Phase 2.

ESD layout (HLTSingapore/Emotional-Speech-Data, 16 kHz):
  ESD/
    0001/                       # 0001-0010 = English speakers, 0011-0020 = Mandarin
      0001.txt                  # tab-separated lines: "<utt_id>\t<transcript>\t<Emotion>"
      Angry/ Happy/ Neutral/ Sad/ Surprise/   *.wav
    0002/ ...

This script:
  - resamples 16 kHz -> 24 kHz mono (codec requirement; mirrors the EMOVO 48->24 step),
  - maps the 5 ESD emotions -> (label, English instruct) using the SAME instruct strings as EMOVO
    where they overlap (neutral = empty instruct = the anchor),
  - emits one row per utterance with a unique `actor` (e.g. esd0001) for speaker diversity.

Usage (on the GPU box, after downloading ESD):
  python3 prepare_esd.py --esd-root ~/qwen-ft/esd/raw --out ~/qwen-ft/esd/train_raw.jsonl \
      --speakers 0001-0010            # English only (cross-lingual transfer); add 0011-0020 for ZH too
  # then run the SAME codec-encode step as EMOVO (prepare_data.py) to get train_with_codes.jsonl,
  # then concatenate with emovo/train_with_codes.jsonl and fine-tune via gpu_sft_expr.py.

NOTE: verify the exact ESD folder/txt layout on the box (releases vary slightly); the emotion folder
names and the per-speaker .txt are the parts to confirm. License: ESD is released for research — verify
before shipping any derived weights (PLAN sanitize TODO).
"""
import os, glob, json, argparse, subprocess, sys

# ESD emotion folder -> (our label, English instruct). neutral = empty (anchor). ESD has no fear/disgust.
EMO = {
    "Neutral":  ("neutral",  ""),
    "Happy":    ("joy",      "Speak happily, bright and warm, smiling through the words."),
    "Angry":    ("anger",    "Speak with hot, furious anger, sharp and forceful."),
    "Sad":      ("sadness",  "Speak with a sad, sorrowful, downcast tone, voice low and heavy."),
    "Surprise": ("surprise", "Speak with surprise, startled and taken aback, held through the whole sentence."),
}

def expand_speakers(spec):
    out = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-"); out += [f"{i:04d}" for i in range(int(a), int(b) + 1)]
        elif part:
            out.append(part if len(part) == 4 else f"{int(part):04d}")
    return out

def load_transcripts(spk_dir, spk):
    """Return {utt_id: text} from <spk>/<spk>.txt (tab-separated: id, text, emotion)."""
    txt = os.path.join(spk_dir, f"{spk}.txt")
    m = {}
    if not os.path.exists(txt):
        return m
    for line in open(txt, encoding="utf-8", errors="ignore"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 2:
            m[parts[0].strip()] = parts[1].strip()
    return m

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--esd-root", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--speakers", default="0001-0010", help="e.g. 0001-0010 (EN) | 0001-0020 (EN+ZH)")
    ap.add_argument("--wav24-dir", default=None, help="where to write 24k wavs (default: <out_dir>/wav24k)")
    a = ap.parse_args()
    speakers = expand_speakers(a.speakers)
    wav24 = a.wav24_dir or os.path.join(os.path.dirname(a.out) or ".", "wav24k")
    os.makedirs(wav24, exist_ok=True)
    rows, n_skip = [], 0
    for spk in speakers:
        spk_dir = os.path.join(a.esd_root, spk)
        if not os.path.isdir(spk_dir):
            print(f"[skip] no speaker dir {spk_dir}", file=sys.stderr); continue
        tx = load_transcripts(spk_dir, spk)
        for folder, (label, instruct) in EMO.items():
            for wav in sorted(glob.glob(os.path.join(spk_dir, folder, "*.wav"))):
                utt = os.path.splitext(os.path.basename(wav))[0]
                text = tx.get(utt)
                if not text:
                    n_skip += 1; continue
                out_wav = os.path.join(wav24, f"esd{spk}_{utt}.wav")
                # resample 16k -> 24k mono
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav,
                                "-ar", "24000", "-ac", "1", out_wav], check=False)
                rows.append({"audio": out_wav, "text": text, "ref_audio": out_wav,
                             "instruct": instruct, "emotion": label, "actor": f"esd{spk}"})
    with open(a.out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    import collections
    by_emo = collections.Counter(r["emotion"] for r in rows)
    by_spk = collections.Counter(r["actor"] for r in rows)
    print(f"wrote {a.out}: {len(rows)} rows, {len(by_spk)} speakers, skipped {n_skip} (no transcript)")
    print("  emotions:", dict(by_emo))

if __name__ == "__main__":
    main()
