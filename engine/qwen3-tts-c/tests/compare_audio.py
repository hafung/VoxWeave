#!/usr/bin/env python3
"""
compare_audio.py — golden-reference correctness check for qwen-tts.

Compares a generated WAV against a committed golden reference by:
  1. DURATION   — |dur_out - dur_ref| / dur_ref must be <= --dur-tol (default 0.05 = 5%)
  2. MEL-CORR   — Pearson correlation of log-mel spectrograms must be >= --min-corr (0.99)

Why mel-corr (not md5): bit-identical output only holds same-platform/same-thread. mel-corr
is robust to benign FP noise AND is the right cross-ISA check — an AVX2 build on x86 will NOT
be bit-identical to the ARM golden, but a CORRECT one must still score ~0.99+. A numerically
broken kernel (or a real regression) drops the correlation, which md5/"non-empty" never catch.

Usage:  compare_audio.py <golden.wav> <output.wav> [--min-corr 0.99] [--dur-tol 0.05]
Exit:   0 = PASS, 1 = FAIL (mismatch), 2 = error (missing file / bad args)
"""
import sys
import argparse
import numpy as np

try:
    import librosa
except ImportError:
    sys.stderr.write("compare_audio: librosa not installed (pip install librosa)\n")
    sys.exit(2)

SR = 24000
N_FFT = 1024
HOP = 256
N_MELS = 128


def log_mel(y):
    m = librosa.feature.melspectrogram(y=y, sr=SR, n_fft=N_FFT, hop_length=HOP, n_mels=N_MELS)
    return librosa.power_to_db(m + 1e-10)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("golden")
    ap.add_argument("output")
    # Empirical basis (2026-06-03, quiet machine, fixed seed): run-to-run mel_corr is
    # 1.00000 across det/-j1-temp0 AND default-4thread-temp0.5 (Qwen3-TTS is NOT audibly
    # non-deterministic with a fixed seed on a quiet box — "poco" = <=±1 LSB). A real
    # regression / under-load token-flip drops it hard (seen: 0.62). So 0.98 tolerates
    # benign variation ("poco sì") with huge margin to catch "tanto". CROSS-ISA (x86 build
    # vs ARM golden) won't be bit-identical — use --min-corr 0.95 there.
    ap.add_argument("--min-corr", type=float, default=0.98)
    ap.add_argument("--dur-tol", type=float, default=0.05)
    ap.add_argument("--label", default="")
    a = ap.parse_args()

    try:
        g, _ = librosa.load(a.golden, sr=SR, mono=True)
        o, _ = librosa.load(a.output, sr=SR, mono=True)
    except Exception as e:
        sys.stderr.write(f"compare_audio: load error: {e}\n")
        sys.exit(2)

    if g.size == 0 or o.size == 0:
        print(f"FAIL {a.label}: empty audio (golden={g.size} out={o.size} samples)")
        sys.exit(1)

    dur_g, dur_o = g.size / SR, o.size / SR
    dur_rel = abs(dur_o - dur_g) / dur_g

    # Align to the shorter signal for the spectral correlation.
    n = min(g.size, o.size)
    mg, mo = log_mel(g[:n]), log_mel(o[:n])
    k = min(mg.shape[1], mo.shape[1])
    vg, vo = mg[:, :k].ravel(), mo[:, :k].ravel()
    corr = float(np.corrcoef(vg, vo)[0, 1]) if vg.std() > 0 and vo.std() > 0 else 0.0

    dur_ok = dur_rel <= a.dur_tol
    corr_ok = corr >= a.min_corr
    status = "PASS" if (dur_ok and corr_ok) else "FAIL"
    print(f"{status} {a.label}: mel_corr={corr:.5f} (>= {a.min_corr}) "
          f"dur={dur_o:.2f}s vs {dur_g:.2f}s (rel {dur_rel*100:.1f}% <= {a.dur_tol*100:.0f}%)")
    if status == "FAIL":
        if not corr_ok:
            sys.stderr.write(f"  mel-correlation too low: {corr:.5f} < {a.min_corr}\n")
        if not dur_ok:
            sys.stderr.write(f"  duration drift too large: {dur_rel*100:.1f}% > {a.dur_tol*100:.0f}%\n")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
