# infra/openvino-vlm-kit

**Status: model deployed and verified on `linkhealth-openvino-vision`
(2026-08-20).** See [../README.md](../README.md) for why this lives outside
`plugins/` and the general kit-directory convention.

**Architecturally different from the other two `infra/` kits.**
[`openvino-queue-kit`](../openvino-queue-kit/README.md) and
[`openvino-self-checkout`](../openvino-self-checkout/README.md) are camera/
event *data sources* feeding the shared
[`vision-insights-store`](../vision-insights-store/README.md) Insight
Storage layer. This kit produces no events and writes nothing to that
datastore — it's a **model-serving endpoint**: a local vision sub-model
meant to sit behind a DSH-side attachment-vision plugin (`dsh-vision-router`,
a config-only integration point — not yet wired as of this writing) and be
called directly over HTTP. Don't fold it into the Insight Storage data flow
by mistake.

## Model

**Phi-3.5-vision-instruct, INT4-quantized** — downloaded pre-converted from
Intel's [`OpenVINO/Phi-3.5-vision-instruct-int4-ov`](https://huggingface.co/OpenVINO/Phi-3.5-vision-instruct-int4-ov)
on Hugging Face. No local NNCF quantization needed: at planning time it
wasn't confirmed whether Intel had published an INT4 build of the *vision*
variant specifically (only the *text-only* Phi-3.5-mini had a confirmed
INT4-ov build) — checking the HF Hub API directly confirmed the vision
INT4-ov repo does exist, so a from-scratch NNCF conversion (which would have
meant loading the full fp16 checkpoint into memory) wasn't necessary. ~2.3GB
on disk across separate OpenVINO IR components (language model, vision
embeddings, vision projection, tokenizer/detokenizer).

## Layout

Unlike the other two kits, there's no upstream GitHub reference-kit repo to
sparse-clone here — the artifact is Hugging Face Hub weights, not a sample
app — so the layout is adapted from the usual `repo/` convention:

- `model/` — **gitignored**. Downloaded OpenVINO IR weights (~2.3GB); not
  present until you run the `hf download` command below.
- `venv/` — **gitignored**.
- `data/test-image.jpg` — **tracked**. A synthetic (drawn with PIL, not
  photographed) test image for the smoke test — this repo only ships
  synthetic data. Regenerate with the snippet in "Running" if it's ever lost.
- `smoke_test.py` — **tracked**. Loads the model in-process and asks it one
  basic question about the test image; this is what's deployed to the VM
  (`/opt/openvino-vlm-kit/`) and run there.

## Setting up

```sh
python3.11 -m venv venv
./venv/bin/pip install 'optimum-intel[openvino]' openvino 'transformers>=4.44' \
    pillow huggingface_hub torchvision accelerate
./venv/bin/hf download OpenVINO/Phi-3.5-vision-instruct-int4-ov --local-dir ./model
```

Two things that weren't obvious going in:

- **`torchvision` is a hidden runtime dependency.** `optimum-intel`/
  `openvino` don't pull it in, but Phi-3.5-vision's `trust_remote_code=True`
  processor (`processing_phi3_v.py`, shipped inside the model repo) imports
  it at load time. Without it, `AutoProcessor.from_pretrained(...,
  trust_remote_code=True)` fails with `ImportError: ... requires ...
  torchvision` — the model itself loads fine; only the processor breaks.
- **`huggingface-cli` is deprecated** in current `huggingface_hub` releases
  — use `hf download`, not `huggingface-cli download` (the old command warns
  and no-ops).

`fastapi` and `uvicorn` are also installed in this venv, ahead of the next
phase (an OpenAI-compatible HTTP wrapper) — see "Not yet done" below; nothing
here uses them yet.

## Running

```sh
./venv/bin/python smoke_test.py
```

Verified on `linkhealth-openvino-vision` (`n2-standard-4`, 4 vCPU / 16GB —
upgraded from `n2-standard-2` for this kit, see "VM sizing" below),
2026-08-20:

```
Loading model from /opt/openvino-vlm-kit/model ...
Loaded in 4.6s
Generating ...

--- Answer (46.1s) ---
The image displays two shapes, a red circle on the left and a blue square on
the right, against a light background, labeled as a 'SYNTHETIC TEST IMAGE'.
```

Correctly identified both shapes, their relative position, and read the text
label baked into the image. ~46s per response on 4 vCPU, CPU-only inference,
single request, no batching/streaming — expected for a 4.2B-parameter model
with no GPU; fine for a reference/demo build, not tuned for low latency.

To regenerate the test image if it's ever lost:

```sh
./venv/bin/python -c "
from PIL import Image, ImageDraw
img = Image.new('RGB', (400, 300), color=(235, 245, 255))
d = ImageDraw.Draw(img)
d.ellipse([40, 60, 160, 180], fill=(220, 40, 40))
d.rectangle([220, 80, 340, 200], fill=(40, 90, 220))
d.text((120, 220), 'SYNTHETIC TEST IMAGE', fill=(0, 0, 0))
img.save('data/test-image.jpg', quality=90)
"
```

## VM sizing note

This kit is what justified resizing `linkhealth-openvino-vision` from
`n2-standard-2` (2 vCPU / 8GB) to `n2-standard-4` (4 vCPU / 16GB). Measured
before resizing: the two YOLO kits' RAM footprint wasn't actually the
constraint — they run on-demand rather than as daemons (only
`vision-insights-store`'s FastAPI process is always-on, using well under
1GB). The real constraint was CPU: this model's inference is CPU-only with
no GPU, and 2 vCPUs would have made an already-slow reference build
uncomfortably slower. Resize is reversible (`gcloud compute instances
stop` → `set-machine-type` → `start`); it briefly took down
`vision-insights-api.service` (auto-restarted on boot, confirmed
`active`/`enabled` afterward — no manual intervention needed).

## Serving + DSH wiring

Both items originally deferred here are now done:

- **`serve.py`** — a minimal OpenAI-compatible `/v1/chat/completions` shim
  over the model (FastAPI), running as the `openvino-vlm-api` systemd
  service on port 8092. Verified via curl (see git history for the exact
  request/response) before anything downstream depended on it.
- **DSH-side wiring** — `dsh-vision-router`'s `httpProviders` config now
  points at this endpoint. See
  [docs/deployment-gcp.md](../../docs/deployment-gcp.md#vision-multimodality-dsh-vision-router--local-phi-35-vision)
  for the integration (config diff, network path, and why a version bump
  was required first) — this README stays focused on the model side only,
  per this directory's convention of linking to the "why"/integration
  narrative rather than repeating it.
