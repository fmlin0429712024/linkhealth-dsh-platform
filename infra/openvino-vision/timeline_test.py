"""Sanity check: sample a fall-detection demo video across its timeline and
verify the assessment tracks the actual event (upright -> falls -> down),
instead of trusting a single random frame."""
import cv2
import numpy as np
import requests

VIDEO = "/opt/openvino-vision/testdata/fall-demo.mp4"
ENDPOINT = "http://localhost:8080/v1/pose"

cap = cv2.VideoCapture(VIDEO)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS)
print(f"total frames={total} fps={fps:.1f} duration={total/fps:.1f}s")

sample_indices = np.linspace(0, total - 1, 12, dtype=int)
for idx in sample_indices:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
    ok, frame = cap.read()
    if not ok:
        continue
    ok2, buf = cv2.imencode(".jpg", frame)
    resp = requests.post(ENDPOINT, files={"file": ("frame.jpg", buf.tobytes(), "image/jpeg")})
    data = resp.json()
    a = data["assessment"]
    t = idx / fps
    print(f"t={t:5.1f}s frame={idx:4d}  flag={a['flag']:<22} risk={a['risk_level']:<8} {a['reason']}")
