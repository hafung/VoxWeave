#!/usr/bin/env python3
"""Extract the GRAFT-LITE .qvoice = everything `--icl-only` uses, WITHOUT the giant WDELTA.

A heavy v3 .qvoice = x-vector + META + TPAD + WOVR + WDELTA. `--icl-only` uses the first four
(x-vector identity + source tts_pad/bos/eos embeds + text_projection/codec_embedding override =
the prosody richness: sighs/pauses) and SKIPS the multi-GB WDELTA weight-swap. So a file truncated
at the start of WDELTA reproduces `--icl-only` BIT-IDENTICALLY at ~25MB instead of ~3GB (120x smaller).

  ./qwen_tts ... --load-voice X_graft.qvoice --icl-only   ==   ... --load-voice X.qvoice --icl-only   (md5-identical)

Usage:
  tests/qvoice_to_graft.py voices/galatea_17b.qvoice           # -> voices/galatea_17b_graft.qvoice
  tests/qvoice_to_graft.py in.qvoice -o out.qvoice
"""
import struct, sys, os, argparse

def wdelta_offset(path):
    with open(path, "rb") as f:
        def u32(): return struct.unpack("<I", f.read(4))[0]
        if f.read(4) != b"QVCE": sys.exit("not a QVCE file")
        ver = u32()
        if ver < 3: sys.exit(f"need v3 qvoice (got v{ver}); v1/v2 have no WOVR/WDELTA split")
        enc = u32()
        f.seek(12 + enc * 4)                      # past x-vector
        rtl = u32(); f.seek(rtl, 1)               # ref_text
        nrf = u32(); f.seek(nrf * 16 * 4, 1)      # ref_codes
        if f.read(4) != b"META": sys.exit("expected META block")
        f.seek(4 + 16 + 4 + 4 + 4 + 64 + 4, 1)    # lang_id,name,model,enc,refdur,voicename,flags
        pos = f.tell()
        if f.read(4) == b"TPAD":
            th = u32(); f.seek(th * 4 * 3, 1)
        else:
            f.seek(pos)
        pos = f.tell()
        if f.read(4) == b"WOVR":
            wh, wth, wcv = u32(), u32(), u32()
            body = wth*wth*2 + wth*4 + wh*wth*2 + wh*4 + wcv*wh*2
            f.seek(body, 1)
        else:
            f.seek(pos)
        return f.tell()

def main():
    ap = argparse.ArgumentParser(description="Make a graft-lite .qvoice (drop WDELTA, keep what --icl-only uses)")
    ap.add_argument("qvoice")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()
    out = a.out or a.qvoice.rsplit(".qvoice", 1)[0] + "_graft.qvoice"
    off = wdelta_offset(a.qvoice)
    total = os.path.getsize(a.qvoice)
    with open(a.qvoice, "rb") as fi, open(out, "wb") as fo:
        fo.write(fi.read(off))
    print(f"wrote {out}: {off/1e6:.2f} MB  (dropped {(total-off)/1e6:.0f} MB WDELTA; {total/off:.0f}x smaller)")
    print(f"  use: --load-voice {out} --icl-only   (== the heavy file's --icl-only, bit-identical)")

if __name__ == "__main__":
    main()
