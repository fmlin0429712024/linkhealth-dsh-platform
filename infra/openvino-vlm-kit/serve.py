#!/usr/bin/env python3
"""Minimal OpenAI-compatible /v1/chat/completions shim over the local
Phi-3.5-vision-instruct OpenVINO model, for dsh-vision-router's `httpProviders`
config to call directly. Not a general-purpose OpenAI server — just enough of
the request/response shape for a single-image, single-turn vision Q&A call."""

import base64
import io
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
from optimum.intel.openvino import OVModelForVisualCausalLM
from transformers import AutoProcessor

MODEL_DIR = Path(__file__).parent / "model"

app = FastAPI()
_model = None
_processor = None


def get_model():
    global _model, _processor
    if _model is None:
        _model = OVModelForVisualCausalLM.from_pretrained(MODEL_DIR, trust_remote_code=True)
        _processor = AutoProcessor.from_pretrained(MODEL_DIR, trust_remote_code=True)
    return _model, _processor


class ChatMessage(BaseModel):
    role: str
    content: object  # str, or a list of {"type": "text"|"image_url", ...} parts


class ChatCompletionRequest(BaseModel):
    model: str = "phi-3.5-vision-local"
    messages: list[ChatMessage]
    max_tokens: int = 200
    temperature: float = 0.0


def _extract_text_and_image(messages: list[ChatMessage]) -> tuple[str, Image.Image | None]:
    """Pull the last user message's text + first image (if any) out of an
    OpenAI-style `content` field, which may be a plain string or a list of
    {"type": "text"|"image_url"} parts."""
    text_parts: list[str] = []
    image: Image.Image | None = None

    for msg in messages:
        if msg.role != "user":
            continue
        content = msg.content
        if isinstance(content, str):
            text_parts.append(content)
            continue
        for part in content:
            ptype = part.get("type")
            if ptype == "text":
                text_parts.append(part.get("text", ""))
            elif ptype == "image_url":
                url = part.get("image_url", {}).get("url", "")
                if url.startswith("data:"):
                    _, _, b64data = url.partition(",")
                    image = Image.open(io.BytesIO(base64.b64decode(b64data))).convert("RGB")

    return "\n".join(text_parts).strip() or "Describe this image.", image


@app.post("/v1/chat/completions")
def chat_completions(req: ChatCompletionRequest):
    text, image = _extract_text_and_image(req.messages)
    if image is None:
        raise HTTPException(status_code=400, detail="No image_url content part found in messages.")

    model, processor = get_model()
    chat_messages = [{"role": "user", "content": f"<|image_1|>\n{text}"}]
    prompt = processor.tokenizer.apply_chat_template(chat_messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=prompt, images=[image], return_tensors="pt")

    output_ids = model.generate(
        **inputs,
        max_new_tokens=req.max_tokens,
        do_sample=req.temperature > 0,
        temperature=req.temperature if req.temperature > 0 else None,
    )
    answer = processor.batch_decode(
        output_ids[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True
    )[0].strip()

    now = int(time.time())
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:16]}",
        "object": "chat.completion",
        "created": now,
        "model": req.model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": answer},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": [{"id": "phi-3.5-vision-local", "object": "model"}]}


@app.get("/health")
def health():
    return {"status": "ok"}
