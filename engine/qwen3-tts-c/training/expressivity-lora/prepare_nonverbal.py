#!/usr/bin/env python3
# Build train_raw.jsonl for a PARALINGUISTIC LoRA from an INLINE-tagged nonverbal corpus.
# Sibling of prepare_manifest.py — but the input modality differs: the paralinguistic
# corpora carry the event INSIDE the transcript (speech -> [laugh] -> speech), and the
# audio lives in-memory in a HuggingFace dataset (not file paths), so this gets its own
# loader. Output schema is IDENTICAL to prepare_manifest.py, so the downstream pipeline
# (prepare_data.py -> train_lora.py -> export_expr.py) is unchanged.
#
# Default source: deepvk/NonverbalTTS (17h English; the best inline format found in the
# 2026-06-12 survey, see DATASETS.md). The shipped tags are EMOJI embedded mid-sentence;
# we map each emoji -> a bracketed marker [laugh]/[breath]/[sigh]/... so the LoRA learns
# marker -> acoustic event (and the SAME map powers an emoji-in-prompt feature later).
#
# LICENSE WARNING: NonverbalTTS annotations are CC BY-NC-SA (NonCommercial) and the audio
# inherits VoxCeleb/Expresso terms — RESEARCH/PROTOTYPE ONLY, not shippable. The HF repo's
# `apache-2.0` tag is contradicted by the README/paper. Use this to VALIDATE THE THEORY;
# pick a shippable base before any release. See DATASETS.md.
#
# The map is DATA-DRIVEN: run with --histogram first to see which emoji actually occur in
# the corpus and how often, then adjust EMOJI_MARKER below from real data (don't trust a
# hand-copied taxonomy). Unknown emoji are STRIPPED by default (raw emoji disturb the model
# and — per our prior test — do nothing useful if passed through).
import argparse, io, json, os, re
from collections import Counter

# emoji base codepoint -> inline marker. Keyed WITHOUT the U+FE0F variation selector /
# skin-tone modifiers (we strip those before lookup). Verify/extend via --histogram on the
# real corpus. The marker text is what the LoRA sees in the transcript; keep it short and
# bracketed so it never collides with real words.
# VALIDATED 2026-06-12 against deepvk/NonverbalTTS train shard 0 (column-projection, 200 rows):
# real freq breath 205 > laugh 66 > cough 13 ~ sniff 13 > sigh 8 > grunt 7 > yawn 1; the only
# UNMAPPED emoji seen were 🗣 (speech-overlap, ambiguous) and 🐖 (annotation noise) — both
# correctly stripped. All 7 meaningful events below matched real data; no orphan U+FE0F remains.
EMOJI_MARKER = {
    "\U0001F923": "[laugh]",    # 🤣  laughter
    "\U0001F32C": "[breath]",   # 🌬  audible breath / inhale
    "\U0001F624": "[sigh]",     # 😤  sigh / heavy exhale
    "\U0001F637": "[cough]",    # 😷  cough / throat-clear
    "\U0001F443": "[sniff]",    # 👃  sniff
    "\U0001F616": "[grunt]",    # 😖  grunt / strain
    "\U0001F927": "[sneeze]",   # 🤧  sneeze
    "\U0001F634": "[yawn]",     # 😴  yawn
    # 🗣️ (U+1F5E3) = "speech overlap/vocalization" — ambiguous, DROPPED by default (add a
    # marker here if --histogram shows it's frequent and you want to model it).
}

# Match any emoji-ish codepoint (broad ranges) so --histogram surfaces EVERYTHING present,
# including ones not in EMOJI_MARKER. The trailing class CONSUMES any variation selector /
# skin-tone / ZWJ that follows the base (e.g. 🌬️ = U+1F32C U+FE0F) so no orphan U+FE0F is
# left in the output text; _STRIP then reduces the match to its base for the EMOJI_MARKER lookup.
_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\U00002B00-\U00002BFF]"
    "[\U0000FE00-\U0000FE0F\U0001F3FB-\U0001F3FF\U0000200D]*"
)
_STRIP = re.compile("[\U0000FE00-\U0000FE0F\U0001F3FB-\U0001F3FF\U0000200D]")  # VS + skin + ZWJ


def map_text(text, hist, kept, dropped):
    """Replace inline emoji with markers; strip unknowns. Mutates the counters.
    Returns (clean_text, markers_present_set)."""
    out, i, markers = [], 0, set()
    for m in _EMOJI_RE.finditer(text):
        out.append(text[i:m.start()])
        base = _STRIP.sub("", m.group(0))
        hist[base] += 1
        mark = EMOJI_MARKER.get(base)
        if mark:
            # pad with spaces so the marker is a standalone token, then squeeze later
            out.append(f" {mark} ")
            kept[base] += 1
            markers.add(mark)
        else:
            dropped[base] += 1   # unknown emoji -> stripped (append nothing)
        i = m.end()
    out.append(text[i:])
    return re.sub(r"\s+", " ", "".join(out)).strip(), markers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hf", default="deepvk/NonverbalTTS", help="HF dataset id")
    ap.add_argument("--split", default="train")
    ap.add_argument("--text-col", default="Result", help="consensus transcript column")
    ap.add_argument("--emotion-col", default="Emotion")
    ap.add_argument("--min-dnsmos", type=float, default=3.0,
                    help="drop clips below this DNSMOS (audio cleanliness); 0 = keep all")
    ap.add_argument("--max-rows", type=int, default=0, help="cap rows for a quick smoke (0 = all)")
    ap.add_argument("--keep-unmapped", action="store_true",
                    help="keep rows whose ONLY nonverbal emoji were unmapped/stripped")
    ap.add_argument("--cap-per-marker", type=int, default=0,
                    help="balance: cap clips per marker; skip a clip if ALL its markers are at cap "
                         "(0 = off). Tames the breath-heavy distribution that over-forces the LoRA.")
    ap.add_argument("--neutral", type=int, default=0,
                    help="ANCHOR: keep up to N marker-FREE (plain) clips as emotion=neutral/instruct='' "
                         "(0 = old behaviour: drop all plain clips). The plain baseline = 'force less'.")
    ap.add_argument("--histogram", action="store_true",
                    help="scan emoji frequency and EXIT (no audio written) — run this first")
    ap.add_argument("--out_dir", default="data_nv")
    args = ap.parse_args()

    from datasets import load_dataset, Audio
    # decode=False -> datasets does NOT decode the audio column itself (avoids the torchcodec
    # hard-dependency in datasets>=4); we get the raw encoded bytes and decode with soundfile.
    ds = load_dataset(args.hf, split=args.split).cast_column("audio", Audio(decode=False))

    hist, kept, dropped = Counter(), Counter(), Counter()

    if args.histogram:
        for ex in ds:
            map_text(ex[args.text_col] or "", hist, kept, dropped)[0]
        print(f"emoji histogram over {len(ds)} rows of {args.hf}[{args.split}]:")
        for cp, n in hist.most_common():
            mark = EMOJI_MARKER.get(cp, "  (UNMAPPED -> stripped)")
            print(f"  U+{ord(cp):05X} {cp}  x{n:<6} -> {mark}")
        print(f"\nmapped occurrences: {sum(kept.values())} | stripped: {sum(dropped.values())}")
        return

    import librosa, soundfile as sf
    wav_dir = os.path.join(args.out_dir, "wav24k"); os.makedirs(wav_dir, exist_ok=True)
    out_jsonl = os.path.join(args.out_dir, "train_raw.jsonl")
    skipped_q, skipped_nonv, skipped_cap = 0, 0, 0
    n_written, n_neutral = 0, 0
    marker_clips = Counter()   # clips written that contain each marker (for --cap-per-marker)

    def write_clip(ex, idx, text, emo):
        a = ex["audio"]   # {'bytes': <encoded>, 'path': ...} (decode disabled -> no torchcodec)
        wav, sr = sf.read(io.BytesIO(a["bytes"]), dtype="float32", always_2d=False)
        if wav.ndim > 1:
            wav = wav.mean(axis=1)   # stereo -> mono
        y = librosa.resample(wav, orig_sr=sr, target_sr=24000) if sr != 24000 else wav
        out = os.path.join(wav_dir, f"{idx:06d}.wav")
        sf.write(out, y, 24000, subtype="PCM_16")
        f.write(json.dumps({"audio": out, "text": text, "ref_audio": out,
                            "instruct": "", "emotion": emo}, ensure_ascii=False) + "\n")

    with open(out_jsonl, "w") as f:
        for idx, ex in enumerate(ds):
            if args.min_dnsmos and (ex.get("dnsmos") or 0) < args.min_dnsmos:
                skipped_q += 1; continue
            text, markers = map_text(ex[args.text_col] or "", hist, kept, dropped)

            if not markers and not args.keep_unmapped:
                # PLAIN clip -> use as the neutral anchor (force less), up to --neutral
                if args.neutral and n_neutral < args.neutral:
                    write_clip(ex, idx, text, "neutral"); n_neutral += 1
                else:
                    skipped_nonv += 1
                continue

            # MARKED clip — balance: skip if ALL its markers already hit the cap
            if args.cap_per_marker and markers and all(marker_clips[m] >= args.cap_per_marker for m in markers):
                skipped_cap += 1; continue
            for m in markers:
                marker_clips[m] += 1
            emo = (ex.get(args.emotion_col) or "neutral").strip().lower()
            write_clip(ex, idx, text, emo)
            n_written += 1
            if args.max_rows and n_written >= args.max_rows:
                break

    print(f"wrote {n_written} marked + {n_neutral} neutral = {n_written + n_neutral} rows -> {out_jsonl}")
    print(f"  skipped: {skipped_q} low-DNSMOS, {skipped_nonv} plain(no-anchor), {skipped_cap} over-cap")
    print(f"  marker CLIP counts (balanced): {dict(marker_clips)}")
    if dropped:
        print(f"  emoji stripped (unmapped): {sum(dropped.values())} occ across {len(dropped)} kinds "
              f"-> rerun with --histogram to inspect")
    print("NEXT: run the upstream prepare_data.py on this jsonl to add audio_codes, then train_lora.py.")


if __name__ == "__main__":
    main()
