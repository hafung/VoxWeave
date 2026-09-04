#!/usr/bin/env python3
"""Adapt a REAL paralinguistic clip toward a TARGET TTS voice's timbre (lightweight VC for non-speech).
Keeps the event's temporal dynamics (the cough-ness); re-colors its spectrum to the voice:
  1) FORMANT WARP: scale the magnitude spectrum's freq axis by alpha = target_centroid/clip_centroid
     (shifts vocal-tract resonances -> speaker size/gender), clamped.
  2) LTAS MATCH: EQ the clip so its long-term average spectrum equals the voice's (overall color/tilt).
Phase kept from the clip (fine for short noisy events).
  timbre_adapt.py clip.wav target_ref.wav out.wav [--strength 1.0]
"""
import sys, argparse, numpy as np, librosa, soundfile as sf

def ltas(mag):                      # long-term avg spectrum, smoothed in freq
    a = mag.mean(axis=1) + 1e-8
    k = 9
    ker = np.ones(k)/k
    return np.convolve(a, ker, mode='same')

ap = argparse.ArgumentParser()
ap.add_argument("clip"); ap.add_argument("target"); ap.add_argument("out")
ap.add_argument("--strength", type=float, default=1.0)
ap.add_argument("--maxdb", type=float, default=12.0)
a = ap.parse_args()
SR = 24000; NF = 1024; HOP = 256
clip, _ = librosa.load(a.clip, sr=SR, mono=True)
tgt,  _ = librosa.load(a.target, sr=SR, mono=True)
rms0 = np.sqrt(np.mean(clip**2)) + 1e-9

Sc = librosa.stft(clip, n_fft=NF, hop_length=HOP)
mag, ph = np.abs(Sc), np.angle(Sc)
St = np.abs(librosa.stft(tgt, n_fft=NF, hop_length=HOP))

# 1) formant warp by spectral-centroid ratio
freqs = librosa.fft_frequencies(sr=SR, n_fft=NF)
cen_c = float((librosa.feature.spectral_centroid(y=clip, sr=SR)).mean())
cen_t = float((librosa.feature.spectral_centroid(y=tgt,  sr=SR)).mean())
alpha = np.clip((cen_t/ (cen_c+1e-6)), 0.7, 1.4)
alpha = 1.0 + (alpha - 1.0) * a.strength
nbins = mag.shape[0]
src_idx = np.arange(nbins)
warp_idx = np.clip(src_idx / alpha, 0, nbins-1)          # sample warped axis
magw = np.empty_like(mag)
for t in range(mag.shape[1]):
    magw[:, t] = np.interp(src_idx, warp_idx, mag[:, t])

# 2) LTAS match (EQ curve, clamped)
eq = ltas(St) / ltas(magw)
eqdb = np.clip(20*np.log10(eq+1e-8), -a.maxdb, a.maxdb) * a.strength
eq = 10**(eqdb/20)
magw *= eq[:, None]

y = librosa.istft(magw*np.exp(1j*ph), hop_length=HOP, length=len(clip))
y *= rms0/(np.sqrt(np.mean(y**2))+1e-9)
sf.write(a.out, np.clip(y,-1,1), SR)
print(f"  adapted {a.clip.split('/')[-1]} -> {a.out.split('/')[-1]}  alpha={alpha:.3f} centroid {cen_c:.0f}->{cen_t:.0f}Hz")
