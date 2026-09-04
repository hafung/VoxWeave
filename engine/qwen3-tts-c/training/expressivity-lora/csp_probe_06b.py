# CSP-FT step 1/2 — Characteristic-Specific layer PROBING for Qwen3-TTS (arXiv 2501.14273).
#
# WHAT: find WHICH Talker layers carry the EMOTION characteristic, so the CSP-FT trainer can fine-tune
#       ONLY those and FREEZE the rest (incl. the pronunciation/prosody layers) -> clean speech (the paper
#       gets CER 1.2% vs full-FT 3.9%). This REPLACES our hand-picked band (L16-26 / L0-27) with a
#       principled, data-driven selection, and removes the need for the disentangle τ subtraction
#       (freezing the knowledge-rich layers does the protecting instead). See plan_emo_v2.md.
#
# HOW (the paper's method): keep the backbone FROZEN. Add a learnable softmax weight-vector W_e over the
#   (num_layers+1) Talker layer outputs + a tiny emotion classifier. Train ONLY (W_e, classifier) to
#   predict the emotion label from a softmax-weighted sum of the per-layer hidden states. After training,
#   softmax(W_e) = per-layer IMPORTANCE for emotion. Select the characteristic-specific layers from it
#   (paper: highest-weight + lowest-weight = 2 layers; we also report top-k for our own A/B).
#
# INPUT: an ENCODED manifest jsonl (rows with `audio_codes`, `emotion`, `language`, optional `instruct`)
#        — the SAME file the CSP-FT trainer consumes. The probe only READS the model (no weight updates),
#        so it is cheap. OUTPUT: a small JSON with per-layer weights + the selected layer set, consumed by
#        gpu_sft_expr_csp.py via --csp-layers.
#
# Self-test (NO model, NO data — verifies the probe head learns to pick a planted layer):
#   python3 csp_probe.py --self-test
#
# Real run (on the GPU box, model + encoded data present):
#   python3 csp_probe.py --train_jsonl /root/qwen-ft/data/multi_emotion_tagged.jsonl \
#       --init_model_path /root/qwen-ft/models/1.7B-CustomVoice \
#       --out_json /root/qwen-ft/csp_layers_italian.json --epochs 3 --top_k 2
import argparse, json, os, random, sys
import torch
import torch.nn as nn


# ----------------------------------------------------------------------------- probe head (model-free)
class LayerProbe(nn.Module):
    """Softmax-weighted combination of per-layer hidden states -> emotion classifier.

    n_layers = number of layer outputs being weighted (= talker num_layers + 1, embeddings + each block).
    Only this module's params are trained; the TTS backbone stays frozen.
    """

    def __init__(self, n_layers, hidden, n_emotions, p_drop=0.1):
        super().__init__()
        self.layer_logits = nn.Parameter(torch.zeros(n_layers))  # -> softmax = per-layer importance
        self.classifier = nn.Sequential(
            nn.LayerNorm(hidden), nn.Dropout(p_drop),
            nn.Linear(hidden, hidden // 2), nn.GELU(),
            nn.Linear(hidden // 2, n_emotions),
        )

    def weights(self):
        return torch.softmax(self.layer_logits, dim=0)

    def forward(self, layer_pooled):
        # layer_pooled: [B, n_layers, hidden] (each layer already mean-pooled over the audio frames)
        w = self.weights().view(1, -1, 1)            # [1, n_layers, 1]
        mixed = (layer_pooled * w).sum(dim=1)        # [B, hidden]
        return self.classifier(mixed)


def select_layers(weights, top_k, n_layers):
    """Pick the characteristic-specific layers from per-layer importance.

    Returns layer INDICES in talker-block space (0..num_layers-1). hidden_states index 0 = the embedding
    output (NOT a transformer block) -> we drop it from selection and map block i -> hidden index i+1.
    Paper picks {argmax, argmin}; we return both that pair and a top_k list for our own sweeps.
    """
    w = weights.tolist()
    # block-only view: indices 1..n_layers-1 of hidden_states map to talker blocks 0..n_layers-2
    block = [(i - 1, w[i]) for i in range(1, n_layers)]  # (block_idx, weight)
    ranked = sorted(block, key=lambda t: t[1], reverse=True)
    topk = sorted(b for b, _ in ranked[:top_k])
    hi = ranked[0][0]
    lo = sorted(block, key=lambda t: t[1])[0][0]
    paper_pair = sorted({hi, lo})
    return {"top_k": topk, "paper_pair": paper_pair,
            "ranked_blocks": [{"layer": b, "weight": round(wt, 5)} for b, wt in ranked]}


# ----------------------------------------------------------------------------- real probing (needs model)
def run_probe(args):
    from accelerate import Accelerator
    from gpu_dataset_expr_lang import TTSDataset
    from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel
    from torch.optim import AdamW
    from torch.utils.data import DataLoader
    from transformers import AutoConfig

    acc = Accelerator(mixed_precision="bf16")
    qwen3tts = Qwen3TTSModel.from_pretrained(args.init_model_path, torch_dtype=torch.bfloat16,
                                             attn_implementation="eager")
    config = AutoConfig.from_pretrained(args.init_model_path)
    for p in qwen3tts.model.parameters():
        p.requires_grad = False           # backbone FROZEN — only the probe head trains
    qwen3tts.model.eval()

    data = [json.loads(l) for l in open(args.train_jsonl)]
    emos = sorted({r["emotion"] for r in data})
    emo2idx = {e: i for i, e in enumerate(emos)}
    acc.print(f"[probe] {len(data)} rows, {len(emos)} emotions: {emos}")

    ds = TTSDataset(data, qwen3tts.processor, config)
    # carry the emotion label alongside the collated batch (collate_fn ignores extra keys per item)
    labels_by_idx = [emo2idx[r["emotion"]] for r in data]

    def collate(batch_items):
        # batch_items are (item_dict, label) — split, collate the dicts, stack labels
        dicts = [b[0] for b in batch_items]
        labs = torch.tensor([b[1] for b in batch_items], dtype=torch.long)
        out = ds.collate_fn(dicts)
        out["emotion_label"] = labs
        return out

    paired = list(zip([ds[i] for i in range(len(ds))], labels_by_idx)) if args.preload else None
    if paired is None:
        # lazy: wrap indices
        class _Paired(torch.utils.data.Dataset):
            def __len__(self): return len(ds)
            def __getitem__(self, i): return (ds[i], labels_by_idx[i])
        paired = _Paired()
    dl = DataLoader(paired, batch_size=args.batch_size, shuffle=True, collate_fn=collate)

    n_layers = config.talker_config.num_hidden_layers + 1   # +1 for the embedding output
    hidden = config.talker_config.hidden_size
    probe = LayerProbe(n_layers, hidden, len(emos), p_drop=args.dropout)
    opt = AdamW(probe.parameters(), lr=args.lr, weight_decay=0.01)
    model, probe, opt, dl = acc.prepare(qwen3tts.model, probe, opt, dl)
    lossf = nn.CrossEntropyLoss()

    probe.train()
    for epoch in range(args.epochs):
        seen = correct = 0
        for step, b in enumerate(dl):
            input_ids = b["input_ids"]; B = input_ids.shape[0]
            tmask = b["text_embedding_mask"]; cmask = b["codec_embedding_mask"]
            # 0.6B: text_hidden 2048 != talker hidden 1024 -> bridge via the model's text_projection
            # (fc1 2048->2048, fc2 2048->1024) before te+ce. (1.7B uses the shared csp_probe.py, dims equal.)
            te = model.talker.text_projection(model.talker.model.text_embedding(input_ids[:, :, 0])) * tmask
            ce = model.talker.model.codec_embedding(input_ids[:, :, 1]) * cmask
            emb = te + ce
            for i in range(1, 16):
                emb = emb + model.talker.code_predictor.get_input_embeddings()[i - 1](b["codec_ids"][:, :, i]) * b["codec_mask"].unsqueeze(-1)
            with torch.no_grad():
                out = model.talker(inputs_embeds=emb[:, :-1, :], attention_mask=b["attention_mask"][:, :-1],
                                   output_hidden_states=True)
            # out.hidden_states[0] = per-layer tuple (matches the trainer's [0][-1] final-layer access)
            hs_tuple = out.hidden_states[0]
            assert len(hs_tuple) == n_layers, f"expected {n_layers} layer outputs, got {len(hs_tuple)}"
            cm = b["codec_mask"][:, :-1].unsqueeze(-1).to(emb.dtype)   # [B, T-1, 1] — pool over audio frames
            denom = cm.sum(dim=1).clamp(min=1.0)                       # [B, 1]
            pooled = torch.stack([(h.to(emb.dtype) * cm).sum(dim=1) / denom for h in hs_tuple], dim=1)  # [B, n_layers, hidden]
            logits = probe(pooled.float())
            loss = lossf(logits, b["emotion_label"])
            acc.backward(loss)
            opt.step(); opt.zero_grad()
            seen += B; correct += (logits.argmax(-1) == b["emotion_label"]).sum().item()
            if step % 10 == 0:
                acc.print(f"epoch {epoch} step {step} loss {loss.item():.4f} acc {correct/max(seen,1):.3f}")
        acc.print(f"[probe] epoch {epoch} train-acc {correct/max(seen,1):.3f}")

    if acc.is_main_process:
        w = acc.unwrap_model(probe).weights().detach().cpu()
        sel = select_layers(w, args.top_k, n_layers)
        result = {"emotions": emos, "n_layers_incl_embed": n_layers,
                  "hidden_index_note": "hidden_states[0]=embedding; block i -> hidden i+1",
                  "per_hidden_weight": [round(x, 5) for x in w.tolist()],
                  "selected": sel, "final_train_acc": round(correct / max(seen, 1), 4)}
        os.makedirs(os.path.dirname(args.out_json) or ".", exist_ok=True)
        with open(args.out_json, "w") as f:
            json.dump(result, f, indent=2)
        acc.print(f"[probe] selected paper_pair={sel['paper_pair']} top_k={sel['top_k']} -> {args.out_json}")
        acc.print(json.dumps(result, indent=2))


# ----------------------------------------------------------------------------- self-test (model-free)
def _self_test():
    """Plant emotion signal in ONE layer of synthetic hidden states; the probe must select that layer."""
    torch.manual_seed(0)
    n_layers, hidden, n_emo, N = 8, 64, 4, 512
    PLANT = 5  # the layer that actually carries the emotion signal (block idx 4 -> hidden idx 5)
    # build per-sample, per-layer pooled hidden: noise everywhere, signal only in layer PLANT
    y = torch.randint(0, n_emo, (N,))
    centers = torch.randn(n_emo, hidden) * 3.0
    pooled = torch.randn(N, n_layers, hidden) * 0.5
    pooled[:, PLANT, :] += centers[y]           # only this layer separates the classes
    probe = LayerProbe(n_layers, hidden, n_emo, p_drop=0.0)
    opt = torch.optim.AdamW(probe.parameters(), lr=5e-3)
    lossf = nn.CrossEntropyLoss()
    for it in range(400):
        idx = torch.randint(0, N, (64,))
        logits = probe(pooled[idx])
        loss = lossf(logits, y[idx])
        opt.zero_grad(); loss.backward(); opt.step()
    w = probe.weights().detach()
    acc = (probe(pooled).argmax(-1) == y).float().mean().item()
    sel = select_layers(w, top_k=2, n_layers=n_layers)
    print("per-layer weights:", [round(x, 3) for x in w.tolist()])
    print(f"argmax hidden-idx: {int(w.argmax())} (planted {PLANT})   train-acc: {acc:.3f}")
    print("selected:", sel)
    assert int(w.argmax()) == PLANT, "probe did NOT concentrate weight on the planted layer"
    assert (PLANT - 1) in sel["top_k"], "planted block not in top_k selection"
    assert acc > 0.9, "probe failed to classify the planted signal"
    print("SELF-TEST PASS — probe concentrates weight on the emotion-carrying layer and selects it.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true", help="run the model-free sanity check and exit")
    ap.add_argument("--train_jsonl")
    ap.add_argument("--init_model_path", default="/root/qwen-ft/models/1.7B-CustomVoice")
    ap.add_argument("--out_json", default="/root/qwen-ft/csp_layers.json")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch_size", type=int, default=8)
    ap.add_argument("--lr", type=float, default=5e-3)
    ap.add_argument("--dropout", type=float, default=0.1)
    ap.add_argument("--top_k", type=int, default=2, help="how many top-weighted blocks to fine-tune in CSP-FT")
    ap.add_argument("--preload", action="store_true", help="materialise all encoded items up-front (more RAM)")
    args = ap.parse_args()
    if args.self_test:
        _self_test(); return
    if not args.train_jsonl:
        ap.error("--train_jsonl required (or use --self-test)")
    run_probe(args)


if __name__ == "__main__":
    main()
