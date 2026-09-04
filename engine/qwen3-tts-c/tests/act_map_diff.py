#!/usr/bin/env python3
"""Contrast QWEN_ACT_MAP fingerprints — where, layer by layer, an instruct/emotion
shifts the Talker activations, and whether emotions/languages are separable in the
multi-layer map (unlike the single-point cp_x mean, which was ~0.83 collinear).

A .qamp file: 'QAMP' magic (uint32 LE) + int32 num_layers + int32 dim + L*D float32
(per-layer mean residual stream; last layer = final-norm hidden). Capture with
  QWEN_ACT_MAP=base.qamp ./qwen_tts ... --instruct "parla in modo neutro" ...
  QWEN_ACT_MAP=ang.qamp  ./qwen_tts ... --instruct "parla arrabbiato" ...

Usage:
  tests/act_map_diff.py BASE.qamp EMO1.qamp [EMO2.qamp ...] [--labels a,b,c] [--top 6]
"""
import struct, sys, argparse, math

MAGIC = 0x504D4151

def read_qamp(path):
    with open(path, "rb") as f:
        magic, L, D = struct.unpack("<Iii", f.read(12))
        if magic != MAGIC:
            sys.exit(f"{path}: bad magic 0x{magic:08x}")
        flat = struct.unpack(f"<{L*D}f", f.read(L*D*4))
    return L, D, [list(flat[l*D:(l+1)*D]) for l in range(L)]

def l2(v): return math.sqrt(sum(x*x for x in v))
def sub(a, b): return [x-y for x, y in zip(a, b)]
def cos(a, b):
    na, nb = l2(a), l2(b)
    return sum(x*y for x, y in zip(a, b))/(na*nb) if na*nb else 0.0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base"); ap.add_argument("emo", nargs="+")
    ap.add_argument("--labels", default="")
    ap.add_argument("--top", type=int, default=6)
    a = ap.parse_args()
    labels = a.labels.split(",") if a.labels else [e.split("/")[-1].replace(".qamp","") for e in a.emo]

    Lb, Db, base = read_qamp(a.base)
    deltas = {}   # label -> per-layer delta vectors
    print(f"# base = {a.base}  ({Lb} layers x {Db} dim)\n")
    for lab, path in zip(labels, a.emo):
        L, D, emo = read_qamp(path)
        if (L, D) != (Lb, Db): sys.exit(f"{path}: shape {L}x{D} != base {Lb}x{Db}")
        d = [sub(emo[l], base[l]) for l in range(L)]
        deltas[lab] = d
        # per-layer relative shift (||delta|| / ||base||)
        rel = [(l, l2(d[l])/(l2(base[l])+1e-9)) for l in range(L)]
        rel_sorted = sorted(rel, key=lambda x: -x[1])
        tag = lambda l: "final" if l == L-1 else f"L{l:02d}"
        prof = "  ".join(f"{tag(l)}:{r*100:4.1f}%" for l, r in rel_sorted[:a.top])
        print(f"[{lab}] strongest shift layers:  {prof}")
    print()

    # cross-emotion separation (the key test): cosine of the FULL multi-layer delta
    if len(deltas) >= 2:
        print("# cross-emotion separation (cosine of full multi-layer delta; LOW = separable)")
        labs = list(deltas)
        full = {k: [x for l in v for x in l] for k, v in deltas.items()}   # concat all layers
        for i in range(len(labs)):
            for j in range(i+1, len(labs)):
                print(f"  cos({labs[i]:>8s}, {labs[j]:>8s}) = {cos(full[labs[i]], full[labs[j]]):+.3f}")
        # also per-layer separation at the layer where emotions differ most
        print("\n# per-layer cos between the first two emotions (find the layers that SEPARATE them)")
        a0, b0 = deltas[labs[0]], deltas[labs[1]]
        per = sorted(((l, cos(a0[l], b0[l])) for l in range(Lb)), key=lambda x: x[1])
        for l, c in per[:a.top]:
            tag = "final" if l == Lb-1 else f"L{l:02d}"
            print(f"  {tag}: cos={c:+.3f}  (lower => this layer distinguishes {labs[0]} from {labs[1]})")

if __name__ == "__main__":
    main()
