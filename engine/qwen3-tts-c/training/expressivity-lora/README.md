# Train an expressivity `.expr` for Qwen3-TTS (any language)

This folder is a **self-contained, reusable recipe** to fine-tune a tiny **expressivity
adapter** for the Qwen3-TTS 1.7B CustomVoice model and export it as a small `<lang>.expr`
micro-file that the C engine loads with `--expr`. It makes **any voice** — a built-in preset
or a cloned `.qvoice` — speak a target language more naturally *and* emote, **without** shipping
a second multi-GB model.

You need: one CUDA GPU (≈12 GB is plenty), Python, and an emotional-speech dataset in your
target language. One run is ~10–20 min on a modern GPU.

> Output sizes: a full fine-tune checkpoint is ~3.8 GB; this recipe ships a **16–63 MB** LoRA
> `.expr` instead. See [`../../docs/expressivity-lora.md`](../../docs/expressivity-lora.md) for the
> technical deep-dive (which layers, why it's small, the file format).

---

## What it does (and why it's small)

The instruct/expressivity competence of Qwen3-TTS lives in a **narrow band of Talker layers,
L16-26** (`self_attn.{q,k,v,o}_proj` + `mlp.gate_proj`) — not the whole network, and *not* the
audio decoder (so voice identity/timbre is untouched). We train a **LoRA** (low-rank adapters)
on exactly those layers, **instruct-conditioned** (a ChatML user turn carrying the emotion) and
**voice-agnostic** (a random preset speaker is injected per sample, so the adapter learns the
emotion→prosody mapping decoupled from any single timbre). We then export only the LoRA factors.

Because a LoRA stores `A[r,in] + B[out,r]` instead of a dense `[out,in]` delta, the file is tiny:

| rank | file size | use |
|---|---|---|
| r=32 | ~32 MB | **preset voices** (they respond strongly; r=32 is plenty) |
| r=64 | ~63 MB | **cloned voices** (their identity damps emotion; higher rank compensates) |

(r=16 already works/expressive; r=128 tends to overfit and rush the words.)

## Pipeline (4 steps)

```
your dataset ─▶ prepare_manifest.py ─▶ <upstream prepare_data.py> ─▶ train_lora.py ─▶ export_expr.py
 (wav+text+    (24kHz mono wavs +      (adds audio_codes via the    (LoRA adapter)   (your <lang>.expr)
  emotion)      train_raw.jsonl)        12 Hz tokenizer)
```

### 0. Install
```bash
pip install torch torchaudio qwen-tts peft accelerate librosa soundfile safetensors lz4
# base model (CustomVoice 1.7B):
huggingface-cli download Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice --local-dir models/1.7B-CustomVoice
```

### 1. Build a manifest from your dataset
`prepare_manifest.py` turns a dataset of `(audio, transcript, emotion)` into 24 kHz-mono WAVs +
a `train_raw.jsonl` with one row per clip: `{audio, text, instruct, emotion}`. The **instruct** is
a vivid **English** sentence describing the emotion (English/Chinese instructs work best — the
model's instruct-following is EN/ZH-centric, even when the spoken text is another language). Edit
the `EMOTION_INSTRUCT` map and the `manifest_rows()` reader for your dataset layout. An EMOVO
(Italian) example is included inline.

```bash
python3 prepare_manifest.py --dataset_dir /path/to/your/corpus --out_dir ./data
```

### 2. Add audio codes (upstream tokenizer)
The trainer needs `audio_codes` per row. Use the official `prepare_data.py` from
[QwenLM/Qwen3-TTS `finetuning/`](https://github.com/QwenLM/Qwen3-TTS) (it runs the 12 Hz audio
tokenizer):
```bash
python3 prepare_data.py --device cuda:0 --tokenizer_model_path models/tokenizer-12hz \
  --input_jsonl ./data/train_raw.jsonl --output_jsonl ./data/train_with_codes.jsonl
```

### 3. Train the LoRA
```bash
# preset-grade adapter (rank 32)
python3 train_lora.py --init_model_path models/1.7B-CustomVoice \
  --train_jsonl ./data/train_with_codes.jsonl --output_dir ./out_lora_r32 \
  --lora_r 32 --lora_alpha 64 --num_epochs 8
```
For a clone-grade adapter use `--lora_r 64 --lora_alpha 128` (keep `alpha = 2·r`).

### 4. Export the `.expr`
```bash
python3 export_expr.py ./out_lora_r32/adapter-final ../../presets/expr/<lang>_r32.expr --lang <Language>
```

### Use it
```bash
# preset
./qwen_tts -d qwen3-tts-1.7b -s vivian -l <Language> -T 1.1 \
  --expr presets/expr/<lang>_r32.expr --instruct "<English instruction>" --text "<text>" -o out.wav
# cloned voice (graft) — use the r64 adapter
./qwen_tts -d qwen3-tts-1.7b --load-voice voices/myvoice.qvoice --icl-only -l <Language> -T 1.1 \
  --expr presets/expr/<lang>_r64.expr --instruct "<English instruction>" --text "<text>" -o out.wav
```
`--expr-weight <m>` doses a LoRA `.expr` at load (1.0 = as trained, 0.6 = subtler).

## Picking a dataset (for expressivity AND language-timbre)

The adapter learns from **emotional speech in the target language**, and it improves both *emotion*
and the *naturalness/accent* of that language (it makes a foreign-native preset speak the language
more idiomatically). Aim for:

- **Multiple emotions per speaker** (neutral + happy/sad/angry/fear/… ) — emotion contrast is what's learned.
- **Multiple speakers** — the voice-agnostic training generalizes better; avoids baking one timbre in.
- **Clean audio resampleable to 24 kHz mono.**
- **The target language** — a per-language adapter; don't mix languages in one `.expr`.
- **More & varied data → richer expressivity.** A few hundred clips already work; thousands are better.

Examples by language:
- **Italian** — EMOVO (6 emotions × 6 speakers; the worked example here).
- **German** — Emo-DB (Berlin Database of Emotional Speech).
- **English** — RAVDESS, CREMA-D, IEMOCAP.
- Many languages are collected under emotional-speech dataset hubs on Hugging Face — search for
  "emotional speech <language>" and check the per-dataset license.

> **Per-language survey (datasets, sizes, licenses, recommendations) → [DATASETS.md](DATASETS.md).**
> The [`confit`](https://huggingface.co/confit) HF org has parquet versions (EMOVO/EmoDB/RAVDESS/…)
> that drop into this exact pipeline — German (EmoDB) is ready to go.

## Notes & gotchas
- Spoken text in the **target language**, instruct in **English/Chinese**, temperature **1.1–1.3**.
- Keep `alpha = 2·r` to hold the injection scale constant when comparing ranks.
- Higher rank ≠ always better: r=128 overfit our 588-clip set (rushed words). With more data, higher
  rank may help — validate by ear across a rich emotion palette, not just loss.
- The adapter is per-(language). Identity/timbre is **not** changed by the `.expr` (decoder untouched).
