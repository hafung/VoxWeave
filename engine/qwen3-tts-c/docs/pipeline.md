# From a sentence to audio: anatomy of one generation

This document explains **what happens, in order, when you hand `qwen_tts` a sentence and get
back a WAV file** — at two reading levels per phase:

- **For humans** — the metaphor / intuition, no math.
- **Technical** — what the code does, where (`file:function`), and **how much it costs**.

Reference numbers: **0.6B on Apple M1, 4 threads**, bf16. Per-frame figures come from
`make cp-microbench` and the inference summary lines. One "frame" = **80 ms of audio** (the
model generates at 12.5 Hz), so to run in real time (RTF 1.0) each frame must cost ≤ 80 ms.
Today a frame costs ~90-110 ms → **RTF ~1.3-1.7** (slightly slower than real time).

---

## Big picture

```
  TEXT                                                           WAV AUDIO
   │                                                                 ▲
   ▼                                                                 │
 [1] Tokenize    [2] Build       [3] Embed       [4] Prefill    [7] Write WAV
     text→IDs        prompt          IDs→vectors     (warm up        24kHz PCM
                     (ChatML)                         the KV cache)      ▲
                                                          │              │
                                                          ▼              │
                                           ┌──────── [5] PER-FRAME LOOP ───────┐
                                           │  codec_head → sample code0          │
                                           │  → Code Predictor (15 passes)       │   [6] Speech
                                           │  → sum embeddings → Talker step     │──▶  Decoder
                                           │  ↺ repeat until EOS                 │    (in parallel)
                                           └─────────────────────────────────────┘
```

**Where the time goes** (typical sentence, 0.6B): phase [4] prefill ~1.65 s (this is the latency
before the first sound, TTFA); phase [5], the autoregressive loop, is **~95% of the total cost**;
everything else (tokenize, embed, WAV write) is background noise (< 1%).

---

## [1] Tokenization — text → integer IDs

**For humans.** I chop the sentence into "word pieces" (BPE) and map them to numbers. `"Ciao"`
might become `[40, 8123]`. It's a dictionary, nothing more.

**Technical.** `qwen_tts_tokenizer.c`, BPE. Output: an array of token IDs.
**Cost: negligible** (< 1 ms for normal sentences). Never the bottleneck.

## [2] Prompt construction — ChatML + speaker + language

**For humans.** I wrap the text in a "form" the model understands: who speaks (speaker), which
language, where speech begins and ends. Like filling in the header of a letter.

**Technical.** `qwen_tts.c` (~line 1044+). Builds the prefill sequence: system tokens + text +
special tokens (`tts_bos`, `tts_pad`, `tts_eos`). For custom voices, the reference frames (KV
voice prefix) are spliced in here too. **Cost: negligible.**

## [3] Embedding — IDs → vectors (← your question: "how much does text→embeddings cost?")

**For humans.** Each token number becomes a vector of ~1024 numbers (0.6B) or ~2048 (1.7B): its
"position in meaning space." It's **a table lookup** plus a tiny transform. Practically free.

**Technical.** `embed_one_text_token_compute()` (`qwen_tts.c:236`):
`text_embedding[id]` (bf16 gather) → `text_projection` with SiLU activation → `hidden` vector.
Optimizations already in place:
- **Special tokens precomputed once** at load (`tts_pad/bos/eos`, lines 622-627).
- **LRU embedding cache** (2048 slots, ~8 MB, line 633) → repeated tokens become a `memcpy`.

> **Direct answer:** turning text into embeddings costs **microseconds per token** — a memory
> gather plus a small projection. **This is not where time is lost.** The real cost comes later,
> in the per-frame recurrence, where ~120 MB of weights are **re-read from DRAM every single
> frame**. Confusing "embedding" with "the cost of the model" is the classic mistake: embeddings
> are the entry ticket, not the journey.

## [4] Prefill — warming up the KV cache

**For humans.** Before it can generate even one sound, the Talker has to "read and digest" the
whole prompt at once, building its internal memory (the KV cache). This is the pause you hear
**before the first sound**.

**Technical.** `qwen_talker_prefill()`. The whole sequence goes through together → it uses a
**batched GEMM** (`cblas_sgemm`, BLAS), efficient because it is compute-bound and parallelizes
well. **Cost: ~1.65 s on the 0.6B = almost the entire TTFA (time-to-first-audio).** Once the KV
cache is filled, each later step is cheap because it reuses that memory instead of recomputing it.

> Note: `feat/streaming-ttfa` already attacked this phase (int8 batched prefill 477→226 ms, TTFA
> 1571→560 ms). See [performance.md](performance.md).

## [5] Autoregressive loop — THE cost (~95%)

**For humans.** Now the model generates audio **one frame at a time** (80 ms each), and each frame
depends on the previous one. Per frame it does two things, in a forced sequence:

1. **The Talker decides "the word/syllable"** (codebook 0) — *what* is said.
2. **The Code Predictor fills in 15 details** (codebooks 1-15) — *how* it sounds: timbre, prosody,
   texture. It does this in **15 sequential passes**, one per detail.

Then it sums all 16 pieces into a single vector and feeds it back to the Talker for the next frame.
**It is a loop: the output of one is the input of the other.** That is why they cannot overlap.

See **"The loop, step by step"** below for the input→output of each step.

## [6] Speech Decoder — codes → waveform (in parallel!)

**For humans.** The 16 codes per frame are still "symbols," not sound. The decoder is a causal
convolutional network that **expands them 480×** up to 24,000 samples/second of real audio. The
trick: it runs on **a separate thread, in parallel** with loop [5], so its cost is **hidden**
behind generation — by the time the loop finishes, the audio is nearly ready.

**Technical.** `qwen_speech_decoder_decode_streaming()`, causal ConvNet, 480× upsampling,
1920 samples/frame. Launched on a `decoder_thread` (`dt_push_frames`, line 1465). Being **causal**
it needs no lookahead → this is what enables streaming. **Cost: overlapped** (≈ 0 on the critical
path under normal conditions).

## [7] WAV write — 24 kHz, 16-bit PCM, mono

**For humans.** I pack the samples into a standard `.wav` file.

**Technical.** `qwen_tts_audio.c`. **Cost: negligible.**

---

## The loop, step by step (for humans)

One full turn of phase [5], in order. "hidden" is a vector of 1024 floats (0.6B) — think of it as
the model's current mental state.

| # | Step | Input → Output | What it does | Cost 0.6B |
|---|---|---|---|---|
| 1 | `codec_head` | `last_hidden[1024]` → `logits[2151]` | Projects the mental state onto the vocabulary: "how much does each possible word-token fit right now?" | ~0.35 ms (incl. step 2) |
| 2 | `sample` | `logits[2151]` → `code0` (one int) | Picks the winning word-token (codebook 0). With `temp=0` it's just argmax → deterministic. | (folded into step 1) |
| 3 | **`cp_predict`** | `last_hidden[1024]` + `code0` → `codes[1..15]` | The Code Predictor runs **15 sequential passes**, each adding one residual detail (texture/prosody) on top of the word. **This is the bottleneck.** | **~58-74 ms/f** |
| 4 | `embed-sum` | `codes[0..15]` (16 ints) → `step_embed[1024]` | Looks up the embedding of each of the 16 codes and sums them + a `tts_pad` token → the next input vector. | negligible |
| 5 | `talker_step` | `step_embed[1024]` → `last_hidden[1024]` | One Talker transformer step: updates the mental state for the next frame, using the KV cache for all past context. | ~28-31 ms/f |
| 6 | (async) `decoder` | `codes[0..15]` → 1920 audio samples | Pushed to the decoder thread; runs in parallel. Does not block the loop. | overlapped |

Then **the new `last_hidden` from step 5 becomes the input to step 1 of the next frame.** That back-edge
is the recurrence. The whole thing repeats ~12.5 times per second of audio until the Talker emits EOS.

**The forced order is: 1 → 2 → 3 → 4 → 5 → (back to 1).** Step 5 cannot start before step 3 finishes,
because `step_embed` (step 4) needs all 16 codes. So **the two heavy parts (CP ~74%, Talker ~25%)
are strictly serial within a frame.**

---

## Low-level: what the CPU actually does per frame

Every heavy step above is the same primitive: a **matrix-vector product** `out = W · x`, where the
**weight matrix `W` is constant** and the **input vector `x` is new every frame**. Concretely, per frame:

- **`codec_head`**: `W[2151×1024]` (bf16) · `x[1024]` (f32) → `logits[2151]`. Streams ~4.4 MB of bf16
  weights, converting bf16→f32 in-register (NEON `vcvt` on ARM; the AVX2 path on x86) and
  multiply-accumulating against `x` held in registers/L1.
- **`cp_predict` (15 passes × 5 layers)**: each layer is QKV matvec → attention → O matvec → gate_up
  matvec → SiLU/SwiGLU → down matvec → RMSNorm. All bf16 matvecs via a hand-written NEON
  `bf16_matvec_fused` (or int8 **SDOT** when `--int8`). **90.7% of CP time is these matvecs.** The CP's
  ~120 MB of weights get **re-read from DRAM 16× per frame**, at ~42% of peak bandwidth.
- **`talker_step`**: one token through the Talker stack (QKV → RoPE → attention over the KV cache → O →
  gate_up → SiLU → down → RMSNorm). Talker weights read once per frame.

**How the weights "move":** they are bf16 and `mmap`ped. The kernel **streams each weight row from
DRAM**, converts it in-register, multiply-accumulates against `x`. `x` is small (1024 floats = 4 KB,
stays hot in L1). The weights are huge and **cold** — they don't fit in cache, so they are read straight
from DRAM, used once, and dropped. That streaming of ~120 MB through the cores **every frame** is the
"data moving up and down" you intuited. The CPU work is dominated by **moving weights, not by the
arithmetic** — this is the textbook definition of a **bandwidth-bound** kernel (low arithmetic intensity).

**Determinism.** With `temp=0` + fixed seed, every step is a pure function: same `x` → same `out`,
bit-identical. There is no randomness in the matvecs; the only randomness was the sampler in step 2,
which `temp=0` removes. So yes — under those conditions the pipeline is a deterministic function. (But
"deterministic" does **not** mean "skippable" — see below.)

---

## Token by token, and the batching question

> *"How does it process token by token? Could we parallelize the loop by splitting 1 tok / 2 tok,
> batching-style?"*

The loop is strictly **batch = 1**: one frame's vector `x` goes through each `W`. Two cases:

- **Within one sentence — NO.** You cannot batch frame `t` and `t+1` of the *same* stream: `t+1`'s
  input (`step_embed`) is literally `t`'s output. That's the recurrence; no amount of cleverness removes
  it. (Likewise the 15 CP passes within a frame are chained: pass `k+1` needs pass `k`.)

- **Across different sentences (requests) — YES, and this is the real lever.** The *same* weight
  matrix `W` applied to `N` independent vectors `x₁…x_N` is **one GEMM of N rows** instead of N separate
  GEMVs. Crucially, that reads `W` from DRAM **once** and reuses it `N` times → arithmetic intensity goes
  up `N×`, and the kernel flips from **bandwidth-bound to compute-bound**. This is **continuous batching**,
  and it is exactly what amortizes the "120 MB per frame" problem. The CP's 15 sequential passes do **not**
  block this: pass `k` of request A is independent of pass `k` of request B, so you batch pass-`k` across
  the `N` requests (15 sequential *batched* GEMMs instead of 15·N sequential GEMVs).

> **Important correction to the worker-pool intuition.** The current `--workers N` pool shares the
> weights in RAM but each worker still issues its **own** GEMV reading those weights. On a bandwidth-bound
> workload that means `N` workers demand `N×` the DRAM bandwidth → they **contend**, and throughput does
> **not** scale (it may even regress). Sharing weights in RAM ≠ amortizing weight reads. **True batching
> — one batched GEMM over N requests' current vectors — is the thing that actually helps**, because it
> reads each weight once and serves N streams from it. That is the difference between "N parallel
> bandwidth-bound streams fighting over memory" and "one compute-bound batched kernel."

> **Measured on M1 (the worker-pool path is a dead-end here).** Splitting a 3-sentence text into 3
> concurrent requests on a `--workers 3` server vs the full text in one request: per-chunk latency
> **tripled** (~6 s solo → ~17 s under 3-way concurrency), aggregate throughput rose only **~8%**
> (0.79 → 0.86 audio-s/s), and total wall-clock was actually **worse** (17.7 s vs 16.4 s). A single
> 4-thread synthesis already **saturates M1's memory bandwidth**, so adding concurrent syntheses just
> contends. **Conclusion: naive worker-level parallel chunking does not help on M1** — only (a) true
> batched-GEMM (reads each weight once for N streams, untested) or (b) a higher-bandwidth machine
> (more memory channels) would. For first-audio latency, prefer **sequential chunk-1-first** (no
> contention: ~6 s to first sound vs ~16 s for the full text), not full concurrency.

> **Measured: true batched-GEMM *does* reuse the weights — but only pays off at N≥4-6.** A microbench
> (Accelerate f32, M1) of N sequential GEMVs (= workers) vs one GEMM of width N (= true batching) on the
> real CP/Talker matvecs: the GEMM time is **flat in N** (CP gate_up ~0.48 ms at N=2…8) while the GEMV
> loop grows linearly — proof the weight is read **once** and extra columns are nearly free. But the GEMM
> carries a fixed cost ~2.5× a single GEMV, so **N=2 loses, break-even ≈ N=3, strong wins (2.3-3.7×) only
> at N≥6**. So batching is a **server-scale / many-chunk lever**, not a 2-3-sentence win: a short one-shot
> gains nothing, but a **long-form / audiobook** split into many chunks (keep N≥6-8 active in a continuous
> batch) gets **2.3-3.7× throughput**. That is the real home for text-splitting as a *speed* lever.

So: splitting 1-tok/2-tok *within* a sentence is impossible; batching the *current frame across N
sentences* is both possible and the highest-value structural change. It is the honest version of the
"batching" goal — and it reframes the worker pool as a stepping stone, not the destination.

---

## Why move the weights every frame? Can we skip it?

> *"Why must I always move this data? Do I need it? The loop is clear — but why redo it every run?
> Can we skip it? If it's a deterministic state machine, can't we cache?"*

The right lateral question, and the answer has three honest parts.

**1. Why the weights move every frame.** A matvec is `f(x) = W·x` with `W` fixed and `x` new each step.
You re-read `W` because you apply it to a **fresh `x`** every frame. With batch = 1 there is nothing to
amortize → you pay the full weight-read for one vector. This isn't waste you can delete; it **is** the
computation. The two ways to pay less are: **(a) make `W` smaller** (quantization), or **(b) reuse `W`
across many `x` at once** (batching). There is no third door for the per-frame matvec.

**2. Determinism ≠ cacheable.** A deterministic `f` means *same input → same output*. Caching only helps
when the **input repeats**. Across two different sentences, the input token stream repeats only in the
**shared prefix** (system prompt + speaker + language), never in the content. And the state is not a
finite automaton you could tabulate: each step's state is a point in continuous ℝ¹⁰²⁴ that depends on the
entire history. Reproducible, yes; enumerable/cacheable, no.

**3. What IS already skipped, and what genuinely can be:**

| Repeats where? | Skippable? | How |
|---|---|---|
| The prefix, *within* one generation | ✅ already done | the **KV cache** stores attention K/V so the prompt isn't recomputed every step — this is the one exact memoization, already in place |
| The prefix, *across* requests (same speaker/language) | ✅ available | the shared system+speaker+language prefix produces **bit-identical KV** for every such request → compute once, clone (**prefix / prompt caching**). A real TTFA win; partially present via the voice KV prefix and the server's delta-prefill |
| Identical full request | ✅ trivial | cache the final WAV at the application layer |
| Content tokens, once the text diverges | ❌ not skippable | every frame's hidden state is unique to that sentence |

**On the "phrase1 vs phrase2 differ by ~1%" intuition.** It's misleading. Hidden states are
**bit-identical only up to the first differing token** (that's *why* prefix caching works); after the
divergence point they decorrelate **fast**, because attention mixes the new token into every later state
and the CP→Talker feedback compounds it. A 1% difference in the output *waveform* does **not** mean 99% of
the computation is shared and reusable — audio is dense information, and that 1% rides on a genuinely
different token sequence and different hidden trajectory. So you cannot "diff two sentences and skip the
overlap" in the generation loop; the only overlap that is exactly reusable is the prefix, and that's
already the target of KV/prefix caching.

> **Synthesis.** You can't skip the per-frame matvec — it's the work itself. You *can* (a) skip the
> **shared prefix** across requests (prompt caching, a TTFA win), (b) make the weights **smaller**
> (quantization, the bandwidth win), and (c) **amortize** the weight reads across **many concurrent
> requests** (true batching, the throughput win). The recurrence forbids skipping *within* a stream;
> determinism buys reproducibility and prefix-caching, not free compute.

---

## Budget summary (typical sentence, 0.6B, M1)

| Phase | When | Cost | % of total |
|---|---|---|---|
| [1-3] Tokenize + prompt + embed | once | < 1 ms total | ~0% |
| [4] Prefill | once (TTFA) | ~1.65 s | fixed startup cost |
| [5] Loop: **Code Predictor** | per frame | **58-74 ms/f** | **~74%** of per-frame |
| [5] Loop: Talker step | per frame | 28-31 ms/f | ~25% of per-frame |
| [5] Loop: codec_head + sample + embed | per frame | < 1 ms/f | ~1% |
| [6] Speech decoder | per frame | overlapped | ~0% (hidden) |
| [7] WAV | once | < 1 ms | ~0% |

**Resulting RTF: ~1.3-1.7** (0.6B). The real levers, in order of expected payoff:
1. **Move fewer bytes in the CP** → quantization (int8 done: -24% RTF; int4 / per-codebook
   mixed-precision = the frontier). See [quantization.md](quantization.md).
2. **Amortize the weight reads** → true cross-request batched-GEMM (the throughput lever above).
   NOTE: the *worker-pool* form (N independent GEMVs) was **measured a dead-end on M1** — ~8%
   throughput, 3× per-request latency (bandwidth-saturated). Only real batched-GEMM or a
   higher-bandwidth machine pays off.
3. **Better int8 kernels on ARM** (i8mm/`smmla`, bf16 `vbfdot` on M2+) and **AVX2/threading on x86**.
4. **Build**: LTO/PGO — **measured no-op here** (LTO ~0%, PGO ~1-2%, within noise; see below).
5. **Speculative decoding** on code0 (Talker) — measured **marginal** here (audio codes repeat little).

---

## Appendix — strategies for sequential dependencies (what works, what doesn't)

The "A depends on B depends on A" problem is the core of all optimization here. The classic CS
strategies, applied to *this* code:

| Strategy | Verdict | Why |
|---|---|---|
| **Quantization** (fewer bytes/weight) | ✅ **strong** | the CP is bandwidth-bound: halving the bytes ≈ halving the cost. The #1 lever. |
| **Cross-request batching** (one GEMM over N requests) | ✅ **strong** | reads each weight once for N streams → amortizes the bandwidth that dominates. The throughput lever. |
| **Pipelining / latency hiding** | ✅ already done on the decoder | decoder runs overlapped. Talker↔CP **cannot** overlap: tight loop. |
| **Prefix / prompt caching** | ✅ available | the shared system+speaker prefix is bit-identical across requests → compute once, clone. TTFA win. |
| **Precompute / LUT** (80s sin/cos style) | ⚠️ only at the edges | works for **small, discrete** domains (embedding cache, special tokens, RoPE). **Not** for matvecs: input is continuous ℝ¹⁰²⁴ → ~0 hit rate, no LUT exists. |
| **Speculative / draft / Medusa / lookahead (Jacobi)** | ⚠️ marginal (measured) | breaks the chain by guessing K tokens and verifying in a batch. Wins on **text**; on **audio codes** predictability is low → small speedup. |
| **n-gram / prompt-lookup** | ⚠️ niche | a form of speculative: needs **highly repetitive** sequences. Maybe useful on silence/padding runs, not on speech. |
| **Early-exit / lower precision on "less important" codebooks** | ❌ counterintuitive | the late codebooks (fine texture) look disposable, but int4 **collapses exactly there** (c11-15: 23-27% fidelity). Cutting where it "feels safe" breaks prosody. |
| **Parallelizing the Talker↔CP loop (same stream)** | ❌ impossible | `step_embed` depends on all 16 codes → `talker_step(t+1)` can't start before CP(t) finishes. Amdahl's wall. |

**Build / inline (current state, from the Makefile):**
- `-O3 -ffast-math -march=native` (macOS), hot kernels marked `static inline`. ✅
- **LTO / PGO: measured, not worth adopting.** A paired interleaved A/B on `cp-microbench`
  (0.6B, `-j1 temp0`, load-drift cancelled) gave **LTO ~0%** and **PGO ~1-2% (in the noise,
  one pair even regressed)**. Expected: the hot kernels are already `static inline` in one TU,
  and the CP is bandwidth-bound — cross-TU inlining and branch/layout tuning don't move a DRAM
  bandwidth wall. A naive non-paired run *looked* like 10%, but that was machine-load drift
  (baseline swung 65→75 ms/f between runs) — the lesson: **always measure build A/Bs paired and
  interleaved on a quiet machine**, never all-A-then-all-B.
- FTZ/denormal-off already handled (`qwen_ftz_on`), critical for int8.

> In one line: the model is slow because it **re-reads ~120 MB of weights from DRAM every frame inside a
> loop that cannot be broken**. The way forward is not to *predict* the generation (the recurrence forbids
> it) nor LUTs (continuous input), but to **move fewer bytes** (quantization), **move them once for many
> requests** (batching), and **skip the shared prefix** (prompt caching).
