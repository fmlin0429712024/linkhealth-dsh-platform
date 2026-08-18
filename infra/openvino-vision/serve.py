"""LinkHealth OpenVINO Vision showcase — pose-estimation-based posture signal.

Serves human-pose-estimation-0001 (OpenVINO Open Model Zoo) over HTTP.
POST an image to /v1/pose, get back 18 COCO-style keypoints plus a
DETERMINISTIC geometric posture flag (torso-angle threshold) — the flag is
computed in code, never left to model/LLM judgment, matching this project's
"deterministic tool decides, narrative layer only reports" pattern.

Known simplification: this decoder takes the single highest-confidence peak
per keypoint heatmap channel (argmax), not the full PAF-based multi-person
grouping the official OpenVINO demo uses. That's the right tradeoff for the
target scenario (one patient in one photo), not for a crowd scene.
"""

import numpy as np
import cv2
import openvino as ov
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

MODEL_XML = "/opt/openvino-vision/model/human-pose-estimation-0001.xml"
INPUT_W, INPUT_H = 456, 256
CONF_THRESHOLD = 0.1
TORSO_ANGLE_THRESHOLD_DEG = 55.0

KEYPOINT_NAMES = [
    "nose", "neck", "r_shoulder", "r_elbow", "r_wrist",
    "l_shoulder", "l_elbow", "l_wrist", "r_hip", "r_knee",
    "r_ankle", "l_hip", "l_knee", "l_ankle", "r_eye",
    "l_eye", "r_ear", "l_ear",
]

app = FastAPI(title="LinkHealth OpenVINO Vision Showcase")

core = ov.Core()
model = core.read_model(MODEL_XML)
compiled = core.compile_model(model, "CPU")
output_heatmaps = compiled.output("Mconv7_stage2_L2")


@app.get("/health")
def health():
    return {"status": "ok", "device": "CPU", "model": "human-pose-estimation-0001"}


def decode_keypoints(heatmaps, orig_w, orig_h):
    hm_h, hm_w = heatmaps.shape[1], heatmaps.shape[2]
    keypoints = {}
    for idx, name in enumerate(KEYPOINT_NAMES):
        channel = heatmaps[idx]
        confidence = float(channel.max())
        y, x = np.unravel_index(np.argmax(channel), channel.shape)
        keypoints[name] = {
            "x": round((x / hm_w) * orig_w, 1),
            "y": round((y / hm_h) * orig_h, 1),
            "confidence": round(confidence, 3),
        }
    return keypoints


def assess_posture(keypoints):
    def confident(name):
        k = keypoints.get(name)
        return k if k and k["confidence"] >= CONF_THRESHOLD else None

    neck = confident("neck")
    l_hip, r_hip = confident("l_hip"), confident("r_hip")
    if l_hip and r_hip:
        hip = {"x": (l_hip["x"] + r_hip["x"]) / 2, "y": (l_hip["y"] + r_hip["y"]) / 2}
    else:
        hip = l_hip or r_hip

    if not neck or not hip:
        return {
            "flag": "insufficient_evidence",
            "risk_level": "Unknown",
            "reason": "neck/hip keypoints not confidently detected",
        }

    dx = hip["x"] - neck["x"]
    dy = hip["y"] - neck["y"]
    torso_angle_deg = abs(np.degrees(np.arctan2(dx, dy if dy != 0 else 1e-6)))

    if torso_angle_deg >= TORSO_ANGLE_THRESHOLD_DEG:
        return {
            "flag": "possible_fall_or_lying",
            "risk_level": "High",
            "reason": f"torso angle {torso_angle_deg:.1f} deg from vertical (>= {TORSO_ANGLE_THRESHOLD_DEG} deg threshold)",
        }
    return {
        "flag": "upright",
        "risk_level": "Low",
        "reason": f"torso angle {torso_angle_deg:.1f} deg from vertical (< {TORSO_ANGLE_THRESHOLD_DEG} deg threshold)",
    }


@app.post("/v1/pose")
async def infer_pose(file: UploadFile = File(...)):
    raw = await file.read()
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return JSONResponse(status_code=400, content={"error": "could not decode image"})

    orig_h, orig_w = img.shape[:2]
    resized = cv2.resize(img, (INPUT_W, INPUT_H))
    input_tensor = resized.transpose(2, 0, 1)[np.newaxis, ...].astype(np.float32)

    result = compiled([input_tensor])
    heatmaps = result[output_heatmaps][0]

    keypoints = decode_keypoints(heatmaps, orig_w, orig_h)
    assessment = assess_posture(keypoints)

    return {
        "model": "human-pose-estimation-0001",
        "image_size": {"width": orig_w, "height": orig_h},
        "keypoints": keypoints,
        "assessment": assessment,
    }
