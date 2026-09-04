# Archived expressivity docs (superseded / abandoned methods)

These are kept for history only. **They describe methods we ABANDONED** — do NOT follow them and do NOT
re-derive from them. The single source of truth for emotional TTS is **[../emotion-THE-recipe.md](../emotion-THE-recipe.md)**
(the `--emotion` recipe, encoded in `main.c`).

| file | what it was | why archived |
|---|---|---|
| `expressivity.md` | `--emotion` redefined as a `.vec`/compound-mood palette + control-vector how-to | superseded by the per-(voice×lang×emotion) recipe; the instruct+temperature finding lives in emotion-THE-recipe.md |
| `expressivity-recipes.md` | per-mood/per-language recipes on the `.vec` engine | the `.vec` control-vector method is abandoned; its per-language table contradicts the shipped recipe |
| `emotion-vector.md` | τ-vector (θ_emo − θ_neutral) task-arithmetic | abandoned (self-marked "NOT done"); replaced by CSP-FT |
| `emotion-seeds.md` | seed palette built on topk4 @ T0.8, EXPR-only, no steer | k4-era; contradicts the shipped k6 / T1.1 / steer recipe |
| `paralinguistics-ft-plan.md` | early para-FT blueprint | its root-cause diagnosis was overturned 2026-06-27 (BPE-split/special-token) |

Live docs: emotion-THE-recipe.md, csp-ft-emotion.md (how the packs were trained), expressivity-lora.md (.expr format),
expressivity-assets.md (asset catalog + manual flags), paralinguistics-{tags,native}.md.
