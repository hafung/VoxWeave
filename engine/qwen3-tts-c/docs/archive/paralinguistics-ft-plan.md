# Serious paralinguistic FT — blueprint (when GPU box is back on)

Why the earlier 1–2 day para CSP-FT failed, and the concrete recipe to fix it. The discovery
(`docs/paralinguistics-native.md`) proved these events are **latent in the weights** → an FT only has to
**amplify** the latent ones (feasible) and **add** the few absent ones (harder). A voice-conditioned TTS
disentangles speaker from content, so **cross-speaker** para data + the model's own voice-conditioning
renders the event **in-voice** at inference — no per-voice training needed.

## The 6 levers (in priority order)

### 1. DATA — the dominant lever (was the real failure)
The old run used **VocalSound only** (~1016 clips, 3 labels, noisy background). Replace with a **mixed,
clean, varied, tagged, multi-speaker** corpus. Candidates (all resampled 24k mono, silence-trimmed):

| dataset | gives | notes |
|---|---|---|
| **EARS** | laughter, breathing, sighs, throat-clear, emotional nonverbals | studio 48k, 107 speakers, very clean — best base |
| **Expresso** (Meta) | laughs, expressive nonverbals, conversational | clean, multi-speaker |
| **NonverbalTTS** | tagged nonverbal vocalizations for TTS | purpose-built, good tagging |
| **EmoV-DB** | amusement/laughter, disgust nonverbals | emotional, per-speaker |
| **ExVo / A-VB (vocal bursts)** | laughs, sighs, gasps, disgust bursts | emotion-labeled bursts |
| **VocalSound** (have it) | cough, sneeze, sniff, throat-clear, laugh, sigh | KEEP but **filter** the noisy clips (SNR gate) |

Rules: **balance per event** (aim ≥ several hundred clean clips each), **many speakers**, drop low-SNR
clips, and keep a held-out set per event for A/B. Build with `concat_manifests.py` (it already FAILs loud
on rows missing `audio_codes`).

### 2. TAGGING / format
- Inline marker at the **exact event position**: `… some words [cough] more words …` (or event-only clips
  with the marker = whole text). Consistent marker set: `[laugh] [sigh] [cough] [sneeze] [throatclear]
  [tsk] [yawn] [gasp] [sniff] [groan] …`.
- **Fix the old conflation**: don't reuse the `emotion` field as the marker for the CSP probe AND the loss
  label — keep the marker as inline text and a separate clean `marker` column.
- Verify the **encoded target** (`audio_codes`) actually contains the event at the tagged frames (spot-check
  by decoding a few rows back to WAV).

### 3. LAYER BAND — the second real failure
The old CSP-FT targeted the **late emotion band** (L21-27). Paralinguistic events live in **L0 (phonetic) +
mid L11-16 + L26** (act-map). So:
- Re-run the **CSP probe on the NEW data** to get the para band empirically (don't reuse the emotion band).
- Train **L0 + mid + late** (not late-only). Expect L0 inclusion → watch language regression closely.

### 4. METHOD — LoRA first (reusable), dense only if weak
- **LoRA** on the para band (rank ~16–32): reusable, cheap, composes with the existing `--expr` stack, low
  language-break risk. This is the default.
- **Dense full-FT** is stronger but, because para touches L0 (language), risks the "svariona/esce di lingua"
  break — only escalate if LoRA under-activates, and gate on a language-hold check.

### 5. EPOCHS / STRENGTH
- **5–8 epochs** (was too few), higher LR than the emotion FT, more data → stronger activation. Early-stop on
  a held-out language-hold + event-emit metric (don't overfit into language break).

### 6. VALIDATION — against the discovery baseline
The trigger method (`docs/paralinguistics-native.md`) is the **floor**. The FT must BEAT it:
- **Latent events** (cough/throatclear/tsk/yawn/disgust/laugh) → FT should make them emit **without** needing
  the onomatopoeia trigger (just the `[tag]`), and **stronger/cleaner**.
- **Absent events** (sneeze, real growl) → the real test: can FT teach them at all? (cross-speaker data +
  conditioning is the bet). A/B FT-`[sneeze]` vs trigger-only.
- Gate: language-hold (no accent drift) on a neutral set + golden mel unchanged for non-tagged text.

## Train-script changes (prep now, GPU box off)
1. **New mixed manifest builder** — download/clean each dataset → unified `{audio,text(with inline marker),
   marker,language,speaker}` jsonl → `concat_manifests.py`.
2. **Encode** — `prepare_data.py` via **`qwen-ft:latest`** docker (NOT a fresh `pip install qwen-tts` — that
   breaks torchaudio ABI; fixed 2026-06-26). Produces `audio_codes`.
3. **CSP probe** on the new data → emit the para band (provide `ranked_blocks`, derived from
   `per_hidden_weight` if absent — the bug we hit before).
4. **Train** — LoRA on the probed band, 5–8 ep; checkpoint + `expr_extract.py` / LoRA export.
5. **Eval harness** — `[tag]`-only (no trigger) on ryan/galatea/vivian, A/B vs `samples/para_native/`.

I can write all of these (manifest builder, dataset cleaners, the prep/probe/train wrappers) with GPU box OFF,
so it's a one-command run when you reheat. The heat-free prep is steps 1–5 scaffolding + dataset download
scripts; only encode/probe/train need the GPU.
