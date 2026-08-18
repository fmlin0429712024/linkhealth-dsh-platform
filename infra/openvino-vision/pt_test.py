"""Test: can the same pose model reliably track a held/standing exercise
posture (bicep curl) with quantitative angle tracking, not just a binary
upright/not-upright flag?"""
import cv2
import numpy as np
import requests

VIDEO = "/opt/openvino-vision/testdata/pt-bicep-curl.mp4"
ENDPOINT = "http://localhost:8080/v1/pose"

cap = cv2.VideoCapture(VIDEO)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS)
print(f"total frames={total} fps={fps:.1f} duration={total/fps:.1f}s")


def angle(a, b, c):
    """Angle at point b, formed by points a-b-c, in degrees."""
    ba = np.array([a["x"] - b["x"], a["y"] - b["y"]])
    bc = np.array([c["x"] - b["x"], c["y"] - b["y"]])
    cos_ang = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
    return np.degrees(np.arccos(np.clip(cos_ang, -1, 1)))


sample_indices = np.linspace(0, total - 1, 20, dtype=int)
for idx in sample_indices:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
    ok, frame = cap.read()
    if not ok:
        continue
    ok2, buf = cv2.imencode(".jpg", frame)
    resp = requests.post(ENDPOINT, files={"file": ("frame.jpg", buf.tobytes(), "image/jpeg")})
    kp = resp.json()["keypoints"]
    t = idx / fps

    confs = {k: kp[k]["confidence"] for k in ["r_shoulder", "r_elbow", "r_wrist", "l_shoulder", "l_elbow", "l_wrist"]}
    avg_arm_conf = sum(confs.values()) / len(confs)

    elbow_angle = None
    if all(confs[k] >= 0.1 for k in ["r_shoulder", "r_elbow", "r_wrist"]):
        elbow_angle = angle(kp["r_shoulder"], kp["r_elbow"], kp["r_wrist"])

    angle_str = f"{elbow_angle:6.1f}deg" if elbow_angle is not None else "  n/a  "
    print(f"t={t:5.1f}s frame={idx:4d}  avg_arm_conf={avg_arm_conf:.2f}  r_elbow_angle={angle_str}")
