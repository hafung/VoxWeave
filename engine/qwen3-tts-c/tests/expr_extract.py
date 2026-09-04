#!/usr/bin/env python3
"""Extract a tiny `<lang>.expr` micro-file = (expr - base) delta on ONLY the
fine-tuned tensors, in the SAME encoding as the `.qvoice` WDELTA section, so the
existing C weight-override loop applies it verbatim.

File layout:
  "QEXP"            magic (4 bytes)
  u32  version=1
  char lang[16]     null-padded language tag (e.g. "Italian")
  u32  reserved=0
  --- then a standard WDLT stream (identical to the .qvoice WDELTA section) ---
  "WDLT"            (4 bytes)
  u32  target_hidden_size   (2048 for 1.7B, 1024 for 0.6B)
  u32  n_tensors
  per tensor:
    u16 name_len; char name[name_len]
    u32 raw_nbytes              (= n_elems * 2, the bf16 byte count)
    u8  dtype = 4               (int16 bit-delta + LZ4)
    u32 comp_size; u8 lz4[comp_size]   (LZ4 block of int16 deltas, no size prefix)

The delta is the integer difference of the bf16 BIT PATTERNS (expr_bits - cv_bits),
lossless when re-applied on the same base: result_bits = cv_bits + delta. Applied on
a CV preset or an --icl-only graft (CV weights intact) it reconstructs `expr` exactly.

Usage:
  python3 tests/expr_extract.py BASE_DIR EXPR_DIR OUT.expr --lang Italian
  python3 tests/expr_extract.py qwen3-tts-1.7b qwen3-tts-1.7b-expr presets/expr/italian.expr --lang Italian
"""
import argparse, json, os, struct, sys
import numpy as np
import lz4.block


def parse_header(path):
    with open(path, "rb") as f:
        hlen = struct.unpack("<Q", f.read(8))[0]
        hdr = json.loads(f.read(hlen))
    return hdr, 8 + hlen  # header dict, byte offset where tensor data begins


def read_bf16(path, hdr, data_off, name):
    e = hdr[name]
    assert e["dtype"] == "BF16", f"{name} is {e['dtype']}, expected BF16"
    s, en = e["data_offsets"]
    with open(path, "rb") as f:
        f.seek(data_off + s)
        raw = f.read(en - s)
    return np.frombuffer(raw, dtype=np.uint16)


def bf16_to_f32(u16):
    return (u16.astype(np.uint32) << 16).view(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base_dir")
    ap.add_argument("expr_dir")
    ap.add_argument("out")
    ap.add_argument("--lang", default="Italian")
    ap.add_argument("--thresh", type=float, default=1e-4,
                    help="relative-L2 above which a tensor is included")
    ap.add_argument("--hidden", type=int, default=2048)
    args = ap.parse_args()

    bp = os.path.join(args.base_dir, "model.safetensors")
    ep = os.path.join(args.expr_dir, "model.safetensors")
    bh, bo = parse_header(bp)
    eh, eo = parse_header(ep)

    keys = sorted(k for k in eh if k != "__metadata__")
    changed = []          # (name, raw_nbytes, lz4_bytes)
    n_overflow = 0
    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    # RMSNorm/bias tensors live as f32 in the engine (not bf16 matrices) → store the
    # FULL expr value as raw f32 (dtype 0, replacement), like the .qvoice WDELTA path.
    # Everything else is a bf16 weight matrix → int16 bit-delta + LZ4 (dtype 4).
    def is_f32_tensor(name):
        return any(s in name for s in ("_norm.weight", "layernorm.weight", ".bias")) \
            or name.endswith(".norm.weight")

    # Build tensor stream in memory (then prepend header + counts).
    stream = bytearray()
    n_f32 = 0
    for k in keys:
        if k not in bh:
            continue
        cv = read_bf16(bp, bh, bo, k)
        ex = read_bf16(ep, eh, eo, k)
        if cv.shape != ex.shape:
            print(f"[shape!] {k} skipped")
            continue
        # include if ANY byte (bf16 bit) differs — norms drift below relL2 1e-4 but matter
        if not np.any(cv != ex):
            continue
        name_b = k.encode()
        if is_f32_tensor(k):
            # raw f32 replacement (dtype 0): the engine holds these as float32
            f32 = bf16_to_f32(ex).astype("<f4")
            payload = f32.tobytes()
            stream += struct.pack("<H", len(name_b)) + name_b
            stream += struct.pack("<I", len(payload))    # data_bytes = n*4
            stream += struct.pack("<B", 0)               # dtype 0 = raw replacement
            stream += struct.pack("<I", len(payload)) + payload
            changed.append((k, len(payload), len(payload)))
            n_f32 += 1
        else:
            # int16 bit-pattern delta (wraps mod 2^16, matching C (int16_t)((int)a-(int)b))
            d32 = ex.astype(np.int32) - cv.astype(np.int32)
            if np.any(d32 > 32767) or np.any(d32 < -32768):
                n_overflow += int(np.count_nonzero((d32 > 32767) | (d32 < -32768)))
            delta = d32.astype(np.int16)
            raw_nbytes = cv.nbytes
            comp = lz4.block.compress(delta.tobytes(), mode="default", store_size=False)
            stream += struct.pack("<H", len(name_b)) + name_b
            stream += struct.pack("<I", raw_nbytes)      # data_bytes = n*2 (bf16)
            stream += struct.pack("<B", 4)               # dtype 4 = int16+LZ4
            stream += struct.pack("<I", len(comp)) + comp
            changed.append((k, raw_nbytes, len(comp)))

    with open(args.out, "wb") as f:
        f.write(b"QEXP")
        f.write(struct.pack("<I", 1))                 # version
        lang_b = args.lang.encode()[:15]
        f.write(lang_b + b"\x00" * (16 - len(lang_b)))
        f.write(struct.pack("<I", 0))                 # reserved
        f.write(b"WDLT")
        f.write(struct.pack("<I", args.hidden))
        f.write(struct.pack("<I", len(changed)))
        f.write(stream)

    raw_mb = sum(c[1] for c in changed) / 1e6
    lz4_mb = sum(c[2] for c in changed) / 1e6
    disk = os.path.getsize(args.out) / 1e6
    print(f"wrote {args.out}")
    print(f"  tensors        : {len(changed)} ({len(changed)-n_f32} bf16-delta + {n_f32} f32-norm)")
    print(f"  raw bf16       : {raw_mb:8.1f} MB")
    print(f"  int16+LZ4      : {lz4_mb:8.1f} MB  ({raw_mb/lz4_mb:.1f}x vs raw bf16)")
    print(f"  on disk        : {disk:8.1f} MB")
    print(f"  lang           : {args.lang}")
    if n_overflow:
        print(f"  [warn] {n_overflow} int16 delta overflow(s) (wrapped) — usually harmless for tiny deltas")


if __name__ == "__main__":
    main()
