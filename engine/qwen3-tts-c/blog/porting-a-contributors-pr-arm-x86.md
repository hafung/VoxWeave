---
title: "A contributor's PR, three rented machines, and four predictions the hardware killed"
published: false
description: "How an external ARM-perf PR pushed our pure-C Qwen3-TTS decoder forward — and how measuring it on a Neoverse-N1 and an EPYC 9555P wrecked almost every conclusion we'd reached from reading the code. The story of what we took, what we rejected, the bugs it surfaced in both directions, and why grep proposes but silicon disposes."
tags: machinelearning, tts, c, performance
---

*Part of [qwen3-tts](https://github.com/gabriele-mastrapasqua/qwen3-tts) — a pure C inference engine for Qwen3-TTS. Follow-up to [Making Qwen3-TTS fast on every CPU](making-qwen3-tts-fast-on-every-cpu.md).*

## TL;DR

An external contributor ([TrinityTF](https://github.com/gabriele-mastrapasqua/qwen3-tts/pull/17)) sent a PR claiming stream RTF **2.2 → 1.3** on a 4-core ARM server. We didn't merge it — the diff conflicted with a month of our own work in the same files. Instead we **hand-ported each idea and measured every one on real silicon**: an Apple M1, a Neoverse-N1 (the same µarch as their box), and an AMD EPYC 9555P.

What came out of it:

- The decoder got **~25–35% faster** on ARM servers (exact streaming conv + an opt-in int8 conv + threaded activations).
- We finally made **int4 competitive on x86** — a throughput-packed AVX-512-VNNI kernel that had eluded us for weeks.
- We found **two bugs in their code** and **one bug of our own** that their work exposed.
- And we were **wrong four times** — every time from reading code instead of running it. Each wrong call is in this post, because the corrections are the interesting part.

RTF = processing time ÷ audio duration; **< 1.0 = faster than real-time**.

---

## The setup: a PR you can't just merge

The PR was good — genuinely good. Bit-exact md5 verification across chunk patterns, SNR analysis on the quantized paths, negative results documented honestly. But it was cut from a commit six weeks stale. Since then we'd landed our own int4-SDOT kernels, x86 VNNI twins, a threading fix, and a streaming-cache change — **all in the exact three files the PR touched**. GitHub said `CONFLICTING`, and it was right.

So the rule for the day was: **no merge. Port each idea by hand, and don't believe any number you didn't measure on the target chip.** We rented two boxes for a few euros each — a Neoverse-N1 (ARM, same class as the contributor's) and an EPYC 9555P Zen5 (x86 with AVX-512-VNNI).

That rule turned out to matter more than any single kernel.

## The one that mattered: exact streaming convolution

Here's the idea we were most glad to get. When you stream audio, you decode it in chunks. Our decoder is a causal ConvNet, so each chunk needs some *context* from the previous one. The old code got that context by **re-decoding the last 20 latent frames every chunk and throwing the audio away** — at a 10-frame chunk that's **3× the convolution work**, all discarded.

The contributor's fix is the right one: carry the actual causal state across chunks — each conv1d keeps its `pad_left` input tail, each transposed conv keeps its overlap-add carry — and feed only the *new* frames. The chunked output then equals the one-shot decode exactly.

This was literally on our TODO, deferred as "large effort." They did it, and bit-exact. On the Neoverse-N1 it took 0.6B streaming int4 from **1.98 → 1.49 RTF (−25%)**.

But porting it is where the fun started.

### Bug #1 (theirs): the index that survives a cache trim

Their exact path read the latent cache at `(latent_frames − new_frames)`. Ours had since added a cache-compaction optimization (`latent_base`) that shifts the physical index. Without subtracting it, the read lands on the wrong row — but **only after the first compaction**, i.e. only on long clips. Silent on everything short. Rebased in the port.

### Bug #2 (ours): the guard that made the carry impossible

This is the good one. To carry state across chunks, the transposed-conv kernel has to emit its *untrimmed* tail columns — that's the overlap-add carry. But our `causal_conv_transpose1d` had a guard, written long ago and correct for every existing caller:

```c
if (out_pos < full_len - trim_right && out_pos < out_len)   // before
```

That first clause **unconditionally drops the tail columns** — exactly the ones the streaming path needs. The carry came out all zeros. The trim is already expressed by `out_len` (one-shot callers pass `out_len = full_len − trim_right`, so they're bit-identical either way), so the guard was redundant *and* actively blocking the new use.

No code review would have caught this. What caught it: the contributor's own **chunked==one-shot** test, which sat at mel-correlation 0.9954 instead of 1.00000 until the guard came out. Their bit-exact discipline found a latent bug in *our* code. That's the best kind of contribution.

```c
if (out_pos < out_len)                                      // after — carry survives
```

## Prediction #1 the hardware killed: "the transcendental debt"

Now the wrong calls. Reading the code, I found that the "snake" activation in the vocoder — `y + (1/β)·sin²(αx)` — called libm's scalar `sinf()` once per element on every branch except Apple's (which uses Accelerate's vectorized `vvsinf`). Same for the SwiGLU's `expf`. My conclusion: on Linux — ARM *and* x86 — we're paying scalar transcendentals across the board, and we should write a vectorized `sin`/`exp` kernel.

I even wrote the ARM one. Then, on the box, I ran `nm -D` on the binary:

```
_ZGVnN4v_sinf   _ZGVnN4v_expf   _ZGVnN4v_erff   _ZGVnN4v_tanhf
```

**GCC with `-ffast-math` was already auto-vectorizing those loops through glibc's `libmvec`.** The "scalar sinf per element" I was going to heroically fix didn't exist on the target toolchain. In the profile, `sinf` didn't even crack 1%. The whole premise was an artifact of reading the code on a Mac, where clang + Accelerate paints a different picture than gcc + glibc.

(The polynomial `sin` we kept — it's correct and it helps on decoder-bound boxes and the AVX2 path clang doesn't autovectorize — but it is a footnote, not the win I'd billed it as.)

## Prediction #2: "the snake is the bottleneck"

If not the transcendentals, surely the snake activation itself? The contributor measured it at 1209 ms on a 7.4s clip. So I profiled with `perf`. Here's where the time actually went on the Neoverse-N1:

| symbol | % of wall |
|---|---|
| `sgemm` (OpenBLAS, the decoder convs) | 30.9% |
| `q4_0_matvec_sdot` (Talker + CP) | 28.8% |
| **kernel scheduler / futex / `sched_yield`** | **~21%** |
| snake | **< 1.5%** |

The snake was noise. The real monster was **21% of wall time in the kernel scheduler** — our thread pool (4 threads) and OpenBLAS (4 threads, its default) fighting over 4 cores, because *nobody had ever told OpenBLAS about `-j`*. On a 64-core box with `-j4`, OpenBLAS was spawning **64** threads.

The fix wasn't a kernel at all. It was binding OpenBLAS to the thread budget — and doing it **per phase**: prefill is all-BLAS with no decoder beside it, so it keeps every thread; generation runs concurrently with the decoder thread, so BLAS steps back one. A flat `OPENBLAS_NUM_THREADS=2` buys 7% RTF but costs 30% of your time-to-first-audio; the two-valued lever gets the throughput without the latency.

## Prediction #3: "bigger chunks are better"

The contributor bumped the streaming chunk default from 10 to 50 frames — fewer chunk boundaries, less overhead. Made sense. I swept it on both boxes:

| chunk frames | RTF on **Neoverse-N1** | RTF on **Apple M1** |
|---|---|---|
| 10 (our default) | 1.60 | **0.56** |
| 24 | 1.51 | 0.57 |
| 50 (their default) | 1.49 | 0.61 |
| 150 | **1.44** | **0.66** |

**Opposite directions.** On the ARM server, bigger chunks win. On the M1, bigger chunks *lose* — by 18%. The cause, measured: on the M1 the decoder isn't the bottleneck, so a big final chunk that has to decode *after* generation finishes (the "drain") can't hide behind anything and lands straight on the wall clock — 134 ms of drain at chunk 10, 1710 ms at chunk 150.

So the contributor's default of 50 would have made our primary dev platform 18% slower. We took their **parameter** (per-request `chunk_frames` is genuinely useful) and rejected their **default**. There is no single good chunk size — it depends on which side of the pipeline is your bottleneck.

## Prediction #4: "the TTFA regressed"

After the exact-conv port, time-to-first-audio looked 8% worse on the N1. I wrote it up as a real regression. Then I re-measured it **paired** — main vs the branch, back-to-back, instead of comparing runs from two different sessions on a machine whose load average had drifted. The 8% vanished. It had never been real; it was measurement noise from a busy box.

(There *was* a small real one, from the exact path convolving all-zero tails on the very first chunk — an all-zero prepended tail is identical to the causal zero-pad the conv already does, so we skip it now. But the scary 8% was an artifact.)

## The x86 payoff: making int4 finally win a kernel

For weeks we'd had an embarrassing result on x86: our AVX-512-VNNI int4 kernel was **37% slower than int8** on the EPYC — the *opposite* of ARM, where int4 wins. The v2 kernel was compute-bound: it zero-extended a 32-int8 block into a 512-bit `dpbusd` (wasting half the datapath) and did a cross-lane horizontal reduce on the critical path every block.

The contributor's PR didn't fix this, but its comments named the fix, and the exercise got us to finally write it: a **v3** that packs **2 blocks per 512-bit op** (full width) and **unrolls 4 output rows** so the reduces from independent rows overlap and hide latency.

The catch: I develop on an M1. I can't *run* AVX-512 — Rosetta emulates AVX2 but SIGILLs on AVX-512. So I verified the *algorithm* in scalar C, emulating `dpbusd`/`unpack`/`inserti64x4` bit-for-bit against a plain reference — matched to 1e-5. Then shipped it behind an env flag and waited for the box.

On the EPYC 9555P, per-frame kernel cost:

| q4 kernel | Talker ms/f | Code Predictor ms/f |
|---|---|---|
| int4 **v3** | **22.9** | **63.5** |
| int4 v2 | 25.1 | 70.0 |
| int8 VNNI | 25.3 | 69.6 |

`--self-test` passed on real VNNI silicon (the scalar emulation held), the v3 kernel is **−9% vs v2**, and **int4-v3 now beats int8 per-frame** — on the same box where v2 trailed by 37%.

One honest caveat, because it bit me: at the *wall clock*, int8 still wins (0.95 vs 1.01 RTF). int4 and int8 fork the greedy sampling trajectory and generate different-length audio, so RTF = wall ÷ duration isn't comparable across quantizations — the fixed costs spread differently. The **kernel** is faster; the **end-to-end** picture is dominated by trajectory length. Both statements are true; only the per-frame one is about the kernel.

## What we rejected, and why

Two things we deliberately didn't take:

- **The spin-pool diff.** Great idea — the pool paid ~7300 futex calls per frame — but the diff deleted our concurrency fix, and its lock-free "is anyone asleep?" check is a store-buffer race that ARM's memory model *hides* and x86's does not (a real deadlock there). We kept the idea and rewrote it: spin-then-park with the ordering fixed and the concurrency guard preserved. Measured gain on our 4-core boxes: ~0, because at `-j4` on 4 cores the pool is almost always runnable. Kept anyway — it's correct, and it should pay on a many-core server with real idle gaps.
- **The deinterleaved q4 packing.** A format change across 13 sites — including our CUDA and Metal decoders, which the contributor's base predated. It would have silently produced wrong GPU audio. Not worth ~2%.

## The lesson

Last post's lesson was "cache beats SIMD width." This one's simpler and more humbling: **on this project, grep proposes and silicon disposes.**

Four times I reached a confident conclusion by reading the code — the transcendental debt, the snake bottleneck, the chunk-size default, the TTFA regression — and four times the hardware said no. Not because the reasoning was sloppy, but because the code on a Mac (clang, Accelerate, Rosetta-AVX2) tells a different story than the code on a Linux server (gcc, libmvec, OpenBLAS, real AVX-512). The only way to know which story is true is to rent the box and run it — paired, on a quiet machine, with the right metric.

The contributor's real gift wasn't the diff. It was pointing at the decoder and making us profile ARM and x86 properly for the first time. Two rented machines and a few euros later, the decoder is 25–35% faster on ARM, int4 finally wins a kernel on x86, and our docs have numbers we can actually defend — because we measured them instead of guessing.

Thanks, [TrinityTF](https://github.com/gabriele-mastrapasqua/qwen3-tts/pull/17). 🙏

## Try it

```bash
# ARM server (decoder-bound): the exact-conv + int8-conv stack
./qwen_tts -d qwen3-tts-0.6b --int4 --stream --stream-chunk 24 --text "..." -o out.wav
QWEN_SD_INT8=1 ./qwen_tts ...   # opt-in int8 decoder conv (quality tradeoff, ear-checked)

# x86 with AVX-512-VNNI: build for it, then A/B the q4 kernel
make blas SIMD=avx512vnni
./qwen_tts --self-test                    # v3 kernel, correctness on your silicon
QWEN_Q4_VNNI_V3=0 ./qwen_tts --self-test  # v2, for comparison
```

Full engineering write-up (every measurement, every rejected idea) is in [`docs/pr17-review.md`](../docs/pr17-review.md); the hardware matrix is in [`docs/hardware-testing.md`](../docs/hardware-testing.md).
