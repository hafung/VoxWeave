#!/usr/bin/env python3
"""CREMA-D -> train_raw.jsonl in the SAME schema as EMOVO (gpu_emovo_prep.py) / ESD (prepare_esd.py),
so CREMA-D's 91 actors align ALONGSIDE EMOVO + ESD for a voice-agnostic, MANY-SPEAKER emotion FT.

WHY CREMA-D: the deep-research lever (docs/emotion-research.md, PLAN Phase 2) is emotion learned across
MANY identities -> it generalizes to cloned / novel x-vectors instead of staying voice-specific. ESD
gives 10 EN speakers with rich text; CREMA-D adds *91* actors (huge identity diversity) over 12 FIXED
sentences and 6 emotions. The two are complementary (text diversity + speaker diversity).

SOURCE: the HF mirror `yukat237/emotional-speech-audio-dataset-3eng-4noneng` (CREMA_D split, parquet,
16 kHz audio bytes). The mirror has NO transcript column, but CREMA-D's 12 sentences are FIXED and keyed
by the 3-letter `sentenceID` -> we look them up below (canonical CREMA-D sentence set).

This script (NEW, dedicated -- it does NOT touch the original gpu_emovo_prep.py / prepare_esd.py):
  - downloads the CREMA_D parquet shards from the mirror,
  - decodes each audio blob and resamples 16 kHz -> 24 kHz mono (codec requirement; mirrors EMOVO/ESD),
  - maps the 6 CREMA-D emotions -> (label, English instruct) using the SAME instruct strings as EMOVO,
  - emits one row per utterance with a unique `actor` (e.g. cremad1001) for speaker diversity,
  - prints PROGRESS every --log-every rows and a final per-emotion / per-speaker breakdown.

Usage (on the GPU box, inside the pytorch docker -- needs pyarrow + soundfile + ffmpeg):
  python3 prepare_cremad.py --out ~/qwen-ft/cremad/train_raw.jsonl
  # then the SAME codec-encode step as EMOVO/ESD (prepare_data.py) -> train_with_codes.jsonl,
  # then concat with the others via concat_manifests.py and fine-tune via gpu_sft_expr.py.

License: CREMA-D is released for research (Open Database License). Verify before shipping derived weights.
"""
import os, json, argparse, subprocess, sys, tempfile, collections, time

REPO = "yukat237/emotional-speech-audio-dataset-3eng-4noneng"
SHARDS = ["data/CREMA_D-00000-of-00002.parquet", "data/CREMA_D-00001-of-00002.parquet"]

# CREMA-D 12 fixed sentences, keyed by the 3-letter sentenceID (canonical CREMA-D set).
SENT = {
    "IEO": "It's eleven o'clock.",
    "TIE": "That is exactly what happened.",
    "IOM": "I'm on my way to the meeting.",
    "IWW": "I wonder what this is about.",
    "TAI": "The airplane is almost full.",
    "MTI": "Maybe tomorrow it will be cold.",
    "IWL": "I would like a new alarm clock.",
    "ITH": "I think I have a doctor's appointment.",
    "DFA": "Don't forget a jacket.",
    "ITS": "I think I've seen this before.",
    "TSI": "The surface is slick.",
    "WSI": "We'll stop in a couple of minutes.",
}

# parquet `emotion` is a class-label INT into the mirror's global names list. CREMA-D uses these 6
# (verified from the mirror schema: 0 Anger, 2 Disgust, 3 Fear, 4 Happy, 5 Neutral, 6 Sad).
# -> (our label, English instruct). neutral = empty instruct (the anchor), same strings as EMOVO/ESD.
EMO = {
    0: ("anger",    "Speak with hot, furious anger, sharp and forceful."),
    2: ("disgust",  "Speak with physical disgust, repulsed and recoiling."),
    3: ("fear",     "Speak with fear, tense and trembling, your voice wary."),
    4: ("joy",      "Speak happily, bright and warm, smiling through the words."),
    5: ("neutral",  ""),
    6: ("sadness",  "Speak with a sad, sorrowful, downcast tone, voice low and heavy."),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--wav24-dir", default=None, help="where to write 24k wavs (default: <out_dir>/wav24k)")
    ap.add_argument("--max-per-speaker", type=int, default=0,
                    help="0 = all (default). Cap utterances per actor to balance vs ESD/EMOVO if needed.")
    ap.add_argument("--log-every", type=int, default=500)
    a = ap.parse_args()

    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download

    wav24 = a.wav24_dir or os.path.join(os.path.dirname(a.out) or ".", "wav24k")
    os.makedirs(wav24, exist_ok=True)
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)

    rows, n_skip, n_done = [], 0, 0
    per_spk = collections.Counter()
    t0 = time.time()
    print(f"[cremad] START -> {a.out}  (wav24={wav24}, max_per_speaker={a.max_per_speaker or 'all'})", flush=True)

    for shard in SHARDS:
        print(f"[cremad] downloading {shard} ...", flush=True)
        f = hf_hub_download(REPO, shard, repo_type="dataset")
        pf = pq.ParquetFile(f)
        print(f"[cremad] {shard}: {pf.metadata.num_rows} rows", flush=True)
        for rg in range(pf.num_row_groups):
            t = pf.read_row_group(rg)
            audio = t.column("audio").to_pylist()
            emo = t.column("emotion").to_pylist()
            spk = t.column("speakerID").to_pylist()
            sent = t.column("sentenceID").to_pylist()
            for au, em, sp, se in zip(audio, emo, spk, sent):
                if em not in EMO or se not in SENT:
                    n_skip += 1; continue
                if a.max_per_speaker and per_spk[sp] >= a.max_per_speaker:
                    continue
                label, instruct = EMO[em]
                actor = f"cremad{sp}"
                out_wav = os.path.join(wav24, f"{actor}_{se}_{em}_{per_spk[sp]:04d}.wav")
                # decode the parquet audio blob (16k wav bytes) -> resample 24k mono via ffmpeg
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    tmp.write(au["bytes"]); src = tmp.name
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src,
                                "-ar", "24000", "-ac", "1", out_wav], check=False)
                os.unlink(src)
                rows.append({"audio": out_wav, "text": SENT[se], "ref_audio": out_wav,
                             "instruct": instruct, "emotion": label, "actor": actor})
                per_spk[sp] += 1
                n_done += 1
                if n_done % a.log_every == 0:
                    print(f"[cremad] {n_done} rows, {len(per_spk)} speakers, "
                          f"{time.time()-t0:.0f}s elapsed", flush=True)

    with open(a.out, "w", encoding="utf-8") as fo:
        for r in rows:
            fo.write(json.dumps(r, ensure_ascii=False) + "\n")

    by_emo = collections.Counter(r["emotion"] for r in rows)
    print(f"[cremad] DONE: wrote {a.out}: {len(rows)} rows, {len(per_spk)} speakers, "
          f"skipped {n_skip}, {time.time()-t0:.0f}s total", flush=True)
    print("[cremad]   emotions:", dict(by_emo), flush=True)


if __name__ == "__main__":
    main()
