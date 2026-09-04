# Making Qwen3-TTS fast on every CPU: SDOT, AVX2 and AVX-512/VNNI

*How a native int8 dot product takes a pure-C text-to-speech engine **faster than real-time on a
2020 MacBook**, and how we brought the same trick to x86 with AVX2 and AVX-512/VNNI — plus the one
lesson that mattered more than any SIMD instruction.*

---

## The setup

[qwen-tts](https://github.com/gabriele-mastrapasqua/qwen3-tts) is a pure-C inference engine for
Qwen3-TTS: a 28-layer transformer (the "Talker"), a 5-layer "Code Predictor" (CP), and a
convolutional speech decoder. No Python, no PyTorch, no GPU. The [previous
post](optimization-notes.md) took it from RTF ~3.5 to ~1.3 on an Apple M1 with cache alignment,
NEON kernels, and pipeline threading. (RTF = processing time ÷ audio duration; **< 1.0 means faster
than real-time**.)

This post is about the next jump: **breaking RTF 1.0**, and making the engine actually fast on
**x86** — where, embarrassingly, the hot kernels used to fall back to scalar code.

## Where the time goes (and why it's not what you'd think)

Profiling is unambiguous: the **Code Predictor is ~75–90% of decode time**, and within it, **90% is
matrix-vector multiply**. The CP runs 15 sequential passes per 80 ms audio frame, **re-reading its
weights 16× per frame**. At bf16 that's ~120 MB of weights pulled from memory, every frame.

So the engine is **memory-bandwidth-bound**, not compute-bound. Keep that in mind — it's the thread
running through everything below.

## ARM: the native int8 dot (SDOT) that broke RTF 1.0

int8 quantization halves the weight bytes (120 MB → 60 MB), which directly helps a memory-bound
workload. But the *old* int8 path threw the win away: it dequantized each int8 weight back to f32 and
did an FMA — ~10 SIMD ops per 16 weights, mostly format conversion.

ARMv8.2 has a better way: **`vdotq_s32` (SDOT)** computes four int8×int8 multiply-accumulates into
int32 in **one instruction**. We quantize the activation vector to int8 on the fly (per-vector
absmax, cheap) and let SDOT do the dot directly — no per-weight dequant. Apple Silicon has had
`__ARM_FEATURE_DOTPROD` since the M1.

The result on a 2020 M1 (0.6B model), `--int8`:

| Mode | bf16 RTF | **`--int8` RTF** |
|---|---|---|
| CLI (short) | 1.5–1.8 | **0.90** |
| CLI (long ~14 s) | ~1.3 | **0.80** |
| Streaming | 1.5–1.8 | **0.81–0.89** (first audio ~0.5 s) |
| HTTP server (warm) | ~1.3 | **0.88** |
| Cloned `.qvoice` voice | 1.34 | **0.93** |

**Faster than real-time, in every delivery mode, on a four-year-old laptop CPU** — at quality
indistinguishable from bf16 by ear (cloned custom voices included). That's the headline.

## x86: the part that was quietly broken

Here's the uncomfortable truth we found auditing the code: on x86, the hot matvec/attention kernels
had **no AVX2 path at all** — they fell through to scalar C. Only a couple of tiny helper functions
had AVX2. A user on a brand-new Ryzen reported the engine was slow; of course it was, it was running
scalar, single-threaded decode on his AVX-512 silicon. So we fixed it properly:

- **AVX2 + FMA twins** for every hot kernel (bf16/int8/q4_0 matvec, argmax, all three attention
  variants), 2-row-fused with multiple accumulators, with a scalar fallback.
- **AVX-512**: a `__m512` 16-wide bf16 matvec.
- **AVX-512-VNNI**: `_mm512_dpbusd_epi32` — the **x86 analog of SDOT** (native int8 dot). The
  activation-quant code is portable C, reused as-is from the ARM path.
- A **cross-OS thread pool** (GCD on macOS, a persistent pthread pool on Linux/Windows) — decode
  threading was macOS-only before.
- A **runtime ISA guard** so a binary built for AVX-512 fails cleanly on an older CPU instead of
  SIGILL, and `make blas SIMD=avx2|avx512|avx512vnni|scalar` to pick the level.

### Validating it on real silicon

We couldn't trust kernels we'd never run, so we rented x86 boxes by the hour:

- **Ryzen 7 6800H** (Zen3+, AVX2, no AVX-512, 16 MB L3): AVX2 gave only **~+6%** over scalar — because
  the workload is memory-bound, not compute-bound. The real win was **`--int4`** (quarter the bytes):
  RTF **3.9 → 2.02** multi-threaded. (On a bandwidth-rich chip like the M1, int4 is *slower* than
  int8 — the nibble-unpack overhead dominates. int4 is a memory-starved-CPU lever, not a universal one.)
- **EPYC 9555P** (Zen5 "Turin", full-width 512-bit AVX-512 + VNNI): this validated the VNNI path is
  numerically correct, and answered the nagging question "is our code even helping?" — emphatically yes:

  | EPYC 9555P, 0.6B, same 1 core | RTF | CP ms/f |
  |---|---|---|
  | scalar bf16 (≈ unoptimized) | 3.04 | 164.8 |
  | **VNNI int8 (our stack)** | **1.64** | 79.3 |

  A **~1.85× speedup at equal core count** — the int8+VNNI kernel halves the Code Predictor's time.
  (We even caught a fun VM artifact: a 4-vCPU cloud slice scatters threads across CPU complexes, so
  `-j1` beat `-j4`. On bare metal, threading scales.)

## The lesson: cache beats SIMD width

The biggest realization is that **single-stream RTF is governed by the memory subsystem, not the
SIMD unit.** Two levers actually move it:

1. **Fewer weight bytes** — `--int8` (and `--int4` on memory-starved CPUs). This is why a native int8
   dot (SDOT / VNNI) matters: it lets you *keep* the byte saving instead of burning it on dequant.
2. **A cache that fits the working set** — the Apple M1's large system-level cache absorbs the
   16×-per-frame re-read, which is *why* it breaks RTF 1.0. A desktop Ryzen **X3D** chip (3D V-cache)
   does the same: ~96 MB of L3 on one core complex fits the int8 CP (~60 MB) entirely in cache.

SIMD width (AVX2 → AVX-512) is the smaller knob: +6% here, +5% there. Necessary to not waste the
silicon, but not where the order-of-magnitude lives.

## Where each CPU lands

| Device | Best 0.6B RTF | Why |
|---|---|---|
| Apple M1 (NEON + SDOT) | **sub-1.0 (int8)** | big system-level cache fits the working set |
| Ryzen 7 6800H (AVX2) | 2.02 (int4) | small L3 → fewer bytes wins |
| EPYC 9555P (Zen5, AVX-512/VNNI) | 1.64 | server chip; great for *throughput*, not single-stream |

A many-core server CPU is wasted on a single stream — its strength is **throughput** (many
concurrent requests), a separate lever we'll explore with batching.

## Try it on your CPU

```bash
git clone https://github.com/gabriele-mastrapasqua/qwen3-tts.git
cd qwen3-tts && git checkout v0.9.0
make blas SIMD=avx512vnni     # or: make blas (portable AVX2) / SIMD=scalar
./qwen_tts --caps             # shows the SIMD/threads actually compiled
./qwen_tts --self-test        # kernel numeric correctness (ISA-independent, no model)
bash tests/x86_bench.sh       # RTF A/B table across precisions
```

`--self-test` is worth a note: it checks each matvec against an f32 reference, so it catches a broken
SIMD kernel **without running the full pipeline** — immune to the way greedy autoregressive decode
forks across architectures (which makes end-to-end audio comparison a false alarm cross-ISA). Full
details and the cross-device methodology are in [docs/x86-optimization.md](../docs/x86-optimization.md).

## What's next

- **Post-M1 ARM**: M2+/Graviton3+ have `vbfdot` (native bf16 dot) and `smmla` (i8mm, a 2×2 int8
  matmul per instruction) — another ~2× on the int8 matvecs, untapped today.
- **Batching**: where a many-core server finally pays off — reuse each weight read across many
  concurrent requests (weight-stationary), trading single-stream latency for throughput.

But the headline stands: **a pure-C TTS engine, faster than real-time on a 2020 laptop, and honestly
fast on x86 too — and the thing that got us there was a single int8 dot-product instruction, not raw
SIMD width.**
