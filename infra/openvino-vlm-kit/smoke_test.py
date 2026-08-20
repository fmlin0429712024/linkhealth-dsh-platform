#!/usr/bin/env python3
"""One-command "does it still work" check: load the local OpenVINO IR model
and ask it a basic question about a bundled test image. Prints the answer;
non-zero exit on any failure."""

import sys
import time
from pathlib import Path

from PIL import Image
from optimum.intel.openvino import OVModelForVisualCausalLM
from transformers import AutoProcessor

MODEL_DIR = Path(__file__).parent / "model"
IMAGE_PATH = Path(__file__).parent / "data" / "test-image.jpg"
PROMPT = "Describe what is shown in this image in one or two sentences."


def main() -> int:
    if not MODEL_DIR.exists():
        print(f"Model dir not found: {MODEL_DIR} — run the download step in README first.", file=sys.stderr)
        return 1
    if not IMAGE_PATH.exists():
        print(f"Test image not found: {IMAGE_PATH}", file=sys.stderr)
        return 1

    print(f"Loading model from {MODEL_DIR} ...")
    t0 = time.time()
    model = OVModelForVisualCausalLM.from_pretrained(MODEL_DIR, trust_remote_code=True)
    processor = AutoProcessor.from_pretrained(MODEL_DIR, trust_remote_code=True)
    print(f"Loaded in {time.time() - t0:.1f}s")

    image = Image.open(IMAGE_PATH).convert("RGB")
    messages = [{"role": "user", "content": f"<|image_1|>\n{PROMPT}"}]
    prompt = processor.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=prompt, images=[image], return_tensors="pt")

    print("Generating ...")
    t0 = time.time()
    output_ids = model.generate(**inputs, max_new_tokens=200, do_sample=False)
    elapsed = time.time() - t0

    answer = processor.batch_decode(
        output_ids[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True
    )[0].strip()

    print(f"\n--- Answer ({elapsed:.1f}s) ---\n{answer}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
