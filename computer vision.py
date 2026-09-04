from __future__ import annotations

import argparse
import platform
import time
from pathlib import Path
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np

import config
from bridge_client import BridgeClient

# MediaPipe Pose landmarks
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
RIGHT_WRIST = 16
RIGHT_PINKY = 18
RIGHT_INDEX = 20

# Smoothing
CHEST_ALPHA = 0.32
WRIST_ALPHA = 0.55
PALM_ALPHA = 0.45           # steadier than the wrist: the guard is a held pose

# Punch tuning: distance is normalized by shoulder width.
READY_DISTANCE = 1.20       # B must first move outside the punch circle
PUNCH_DISTANCE = 0.80       # circular punch-zone radius in shoulder widths
MIN_APPROACH_SPEED = 0.45   # normalized-distance decrease per second
PUNCH_COOLDOWN_S = 0.65
PUNCH_TEXT_DURATION_S = 0.45

# Guard tuning: the palm brought back onto the chest, and held there.
#
# Guard shares the punch circle instead of drawing its own: entering at
# PUNCH_DISTANCE and releasing at READY_DISTANCE is the same ring the punch
# detector already arms/fires against, so there is one zone on screen, not two.
# A punch also finishes with the fist crossing back over the chest — thrown at
# the camera, the arm foreshortens and the wrist converges on A — so the two
# gestures can only be told apart by how long the hand stays. GUARD_DWELL_S is
# that difference: a punch passes through the circle in a few frames, a guard
# parks in it.
GUARD_DWELL_S = 0.20        # how long the palm must stay inside before it counts

# Hand direction: B must be this far from A before UP/DOWN/LEFT/RIGHT is shown.
HAND_DIRECTION_MIN_DISTANCE = 0.55

# --- Game-facing normalisation -------------------------------------------
#
# The game steers on -1..1 per axis and knows nothing about pixels, so the two
# tracked points are converted here rather than in the browser.

# Maps the three drawn zones onto the game's three standing positions: at 3.0
# the centre of the LEFT third is exactly -1 and the centre of the RIGHT third
# exactly +1, so where the player sees themselves standing on screen is where
# the game puts them.
BODY_GAIN = 3.0

# Arm length at full extension, in shoulder widths. Divides the wrist offset so
# a fully stretched arm reads as 1.0, which is what the game's reach deadzone
# is scaled against.
HAND_FULL_REACH = 1.10

# Where the vision state is posted. The bridge merges it with the controller.
DEFAULT_BRIDGE_URL = "http://127.0.0.1:5000/api/vision"


class PointEMA:
    def __init__(self, alpha: float):
        self.alpha = float(alpha)
        self.value: Optional[np.ndarray] = None

    def update(self, point: np.ndarray) -> np.ndarray:
        point = np.asarray(point, dtype=np.float32)
        if self.value is None:
            self.value = point.copy()
        else:
            self.value = self.alpha * point + (1.0 - self.alpha) * self.value
        return self.value.copy()

    def reset(self):
        self.value = None


class ScalarEMA:
    def __init__(self, alpha: float):
        self.alpha = float(alpha)
        self.value: Optional[float] = None

    def update(self, value: float) -> float:
        value = float(value)
        if self.value is None:
            self.value = value
        else:
            self.value = self.alpha * value + (1.0 - self.alpha) * self.value
        return float(self.value)


class DistancePunchDetector:
    """READY -> PUNCH detector based on A-B 2D distance."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.armed = False
        self.last_t: Optional[float] = None
        self.last_distance: Optional[float] = None
        self.last_punch_t = -1e9
        self.state = "WAITING"

    def update(self, t: float, distance_norm: float) -> tuple[bool, float]:
        approach_speed = 0.0

        if self.last_t is not None and self.last_distance is not None:
            dt = t - self.last_t
            if 0.001 < dt < 0.30:
                # Positive = B is moving closer to A.
                approach_speed = (self.last_distance - distance_norm) / dt

        # Arm only after fist has moved away from chest.
        if distance_norm >= READY_DISTANCE:
            self.armed = True
            self.state = "READY"

        punch = False
        cooldown_ok = (t - self.last_punch_t) >= PUNCH_COOLDOWN_S

        if (
            self.armed
            and cooldown_ok
            and distance_norm <= PUNCH_DISTANCE
            and approach_speed >= MIN_APPROACH_SPEED
        ):
            punch = True
            self.armed = False
            self.last_punch_t = t
            self.state = "PUNCH"
        elif not self.armed:
            self.state = "WAITING"

        self.last_t = t
        self.last_distance = distance_norm
        return punch, approach_speed


class PalmGuardDetector:
    """Guard held while the palm sits inside the shared punch/guard circle.

    Same ring the punch detector fires against (PUNCH_DISTANCE in, READY_DISTANCE
    out) — bring the hand back in and the guard is up, push it away and the
    guard drops — with two guards against reading a punch as a block: the
    dwell below, and a release radius wider than the entry one so a palm
    resting on the boundary does not flicker.
    """

    def __init__(self):
        self.reset()

    def reset(self):
        self.active = False
        self.inside_since: Optional[float] = None
        self.state = "OPEN"

    def update(self, t: float, distance_norm: Optional[float]) -> tuple[bool, bool]:
        """-> (guard is up now, guard went up on this frame)."""
        if distance_norm is None:
            # A guard the camera cannot see is a guard that is not up. Dropping
            # it beats holding a stale one through the blow it was meant to stop.
            self.reset()
            return False, False

        limit = READY_DISTANCE if self.active else PUNCH_DISTANCE

        if distance_norm > limit:
            self.inside_since = None
            self.active = False
            self.state = "OPEN"
            return False, False

        if self.inside_since is None:
            self.inside_since = t

        if not self.active and (t - self.inside_since) >= GUARD_DWELL_S:
            self.active = True
            self.state = "GUARD"
            return True, True

        self.state = "GUARD" if self.active else "SETTLING"
        return self.active, False


def open_camera(index: int):
    if platform.system() == "Windows":
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if cap.isOpened():
            return cap
        cap.release()
    return cv2.VideoCapture(index)


def visible(lm) -> bool:
    v = getattr(lm, "visibility", 1.0)
    if v is None:
        return True
    return float(v) >= config.MIN_VISIBILITY


def landmark_to_display_pixel(lm, width: int, height: int, mirror: bool) -> np.ndarray:
    x = float(lm.x)
    y = float(lm.y)
    if mirror:
        x = 1.0 - x
    return np.array([x * width, y * height], dtype=np.float32)


def to_bottom_left_xy(point: np.ndarray, width: int, height: int) -> tuple[float, float]:
    """Bottom-left = (0,0), +X right, +Y up."""
    x = float(np.clip(point[0], 0, width))
    y = float(np.clip(height - point[1], 0, height))
    return x, y


def relative_to_chest_xy(chest: np.ndarray, wrist: np.ndarray) -> tuple[float, float]:
    """Moving coordinate system: chest A=(0,0), +X right, +Y up."""
    dx = float(wrist[0] - chest[0])
    dy = float(chest[1] - wrist[1])  # invert OpenCV Y so up is positive
    return dx, dy


def palm_center(
    wrist: np.ndarray,
    index: Optional[np.ndarray],
    pinky: Optional[np.ndarray],
) -> np.ndarray:
    """The middle of the hand, from the landmarks Pose actually gives.

    There is no palm landmark, but the index and pinky knuckles straddle one,
    and the midpoint between that knuckle line and the wrist lands inside a
    closed fist. Either knuckle can drop out mid-throw without the guard
    disappearing with it, so both are optional and the wrist is the floor.
    """
    knuckles = [point for point in (index, pinky) if point is not None]
    if not knuckles:
        return wrist.copy()
    return (np.mean(knuckles, axis=0).astype(np.float32) + wrist) * 0.5


def chest_center(left_shoulder: np.ndarray, right_shoulder: np.ndarray) -> np.ndarray:
    """Estimate chest A from shoulder midpoint, shifted slightly downward."""
    mid = (left_shoulder + right_shoulder) * 0.5
    shoulder_width = float(np.linalg.norm(left_shoulder - right_shoulder))
    chest = mid.copy()
    chest[1] += 0.28 * shoulder_width
    return chest


def zone_from_x(x: float, width: int) -> str:
    if x < width / 3.0:
        return "LEFT"
    if x > width * 2.0 / 3.0:
        return "RIGHT"
    return "CENTER"


def clamp_unit(value: float) -> float:
    return float(max(-1.0, min(1.0, value)))


def body_axis(chest_x: float, width: int) -> float:
    """Chest position across the frame as the game's -1 LEFT .. +1 RIGHT axis."""
    return clamp_unit((chest_x / max(width, 1) - 0.5) * BODY_GAIN)


def hand_axes(relative_xy: tuple[float, float], shoulder_width: float) -> tuple[float, float]:
    """Wrist offset from the chest as the game's reach axes, -1..1 each.

    Normalised by shoulder width so the same gesture reads the same whether the
    player is standing two metres from the camera or five.
    """
    scale = max(shoulder_width, 1.0) * HAND_FULL_REACH
    return clamp_unit(relative_xy[0] / scale), clamp_unit(relative_xy[1] / scale)


def hand_direction(dx: float, dy: float, distance_norm: float) -> Optional[str]:
    """Classify B relative to moving chest origin into 4 directional sectors."""
    if distance_norm < HAND_DIRECTION_MIN_DISTANCE:
        return None

    if abs(dx) >= abs(dy):
        return "RIGHT" if dx > 0 else "LEFT"

    return "UP" if dy > 0 else "DOWN"


def draw_axes(frame):
    h, w = frame.shape[:2]
    origin = (0, h - 1)
    color = (220, 220, 220)
    cv2.arrowedLine(frame, origin, (min(110, w - 1), h - 1), color, 2, cv2.LINE_AA, tipLength=0.10)
    cv2.arrowedLine(frame, origin, (0, max(0, h - 111)), color, 2, cv2.LINE_AA, tipLength=0.10)
    cv2.putText(frame, "(0,0)", (8, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)
    cv2.putText(frame, "+X", (118, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)
    cv2.putText(frame, "+Y", (8, max(25, h - 120)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)


def draw_moving_chest_axes(frame, chest: np.ndarray):
    """
    Second XY axis that moves with the chest.
    Chest A is always (0,0). Diagonal guides create UP/DOWN/LEFT/RIGHT sectors.
    """
    h, w = frame.shape[:2]
    cx = int(round(float(chest[0])))
    cy = int(round(float(chest[1])))

    axis_color = (0, 255, 255)
    guide_color = (150, 150, 150)

    # Moving X/Y axes through chest.
    cv2.line(frame, (0, cy), (w - 1, cy), axis_color, 1, cv2.LINE_AA)
    cv2.line(frame, (cx, 0), (cx, h - 1), axis_color, 1, cv2.LINE_AA)

    cv2.arrowedLine(frame, (cx, cy), (min(w - 1, cx + 100), cy),
                    axis_color, 2, cv2.LINE_AA, tipLength=0.10)
    cv2.arrowedLine(frame, (cx, cy), (cx, max(0, cy - 100)),
                    axis_color, 2, cv2.LINE_AA, tipLength=0.10)

    # 45-degree boundaries for 4 directional sectors.
    length = max(w, h) * 2
    cv2.line(frame, (cx - length, cy - length), (cx + length, cy + length),
             guide_color, 1, cv2.LINE_AA)
    cv2.line(frame, (cx - length, cy + length), (cx + length, cy - length),
             guide_color, 1, cv2.LINE_AA)

    cv2.putText(frame, "A (0,0)", (cx + 12, cy + 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, axis_color, 2, cv2.LINE_AA)

    # Direction labels move with chest.
    cv2.putText(frame, "UP", (cx - 20, max(24, cy - 125)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255,255,255), 2, cv2.LINE_AA)
    cv2.putText(frame, "DOWN", (cx - 35, min(h - 15, cy + 135)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255,255,255), 2, cv2.LINE_AA)
    cv2.putText(frame, "LEFT", (max(5, cx - 145), cy + 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255,255,255), 2, cv2.LINE_AA)
    cv2.putText(frame, "RIGHT", (min(w - 90, cx + 85), cy + 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255,255,255), 2, cv2.LINE_AA)



def draw_action_circle(
    frame,
    chest: np.ndarray,
    shoulder_width: float,
    wrist: Optional[np.ndarray],
    palm: Optional[np.ndarray],
    guard_active: bool,
):
    """Draw the one circle punch and guard both judge against.

    Circle center:
        A = chest

    Circle radius:
        shoulder_width * PUNCH_DISTANCE

    A PUNCH event needs READY -> moving toward A -> entering this circle. A
    GUARD needs the palm inside this same circle, held for GUARD_DWELL_S. The
    ring is filled while guard is up — the player has no view of the game
    while looking at this window, so the block has to be legible from here.
    """
    h, w = frame.shape[:2]

    cx = int(round(float(chest[0])))
    cy = int(round(float(chest[1])))

    radius = int(round(max(10.0, shoulder_width * PUNCH_DISTANCE)))
    radius = min(radius, max(w, h))

    color = (255, 200, 0) if guard_active else (0, 165, 255)

    if guard_active:
        # A wash rather than a solid fill, so the landmarks under it stay visible.
        overlay = frame.copy()
        cv2.circle(overlay, (cx, cy), radius, color, -1, cv2.LINE_AA)
        cv2.addWeighted(overlay, 0.25, frame, 0.75, 0, frame)

    cv2.circle(frame, (cx, cy), radius, color, 2, cv2.LINE_AA)

    label_y = max(24, cy - radius - 8)
    cv2.putText(
        frame,
        "GUARD" if guard_active else "PUNCH / GUARD ZONE",
        (max(5, cx - 68), label_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        color,
        2,
        cv2.LINE_AA,
    )

    # Optional small indicator showing whether B is currently inside.
    if wrist is not None:
        distance_px = float(np.linalg.norm(wrist - chest))
        status = "B INSIDE" if distance_px <= radius else "B OUTSIDE"
        cv2.putText(
            frame,
            status,
            (max(5, cx - 48), min(h - 10, cy + radius + 22)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            color,
            2,
            cv2.LINE_AA,
        )

    if palm is not None:
        px, py = int(round(float(palm[0]))), int(round(float(palm[1])))
        cv2.circle(frame, (px, py), 7, color, -1 if guard_active else 2, cv2.LINE_AA)
        cv2.putText(frame, "P", (px + 10, py + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 2, cv2.LINE_AA)


def draw_zones(frame, active_zone: Optional[str]):
    h, w = frame.shape[:2]
    x1 = int(w / 3)
    x2 = int(2 * w / 3)
    cv2.line(frame, (x1, 0), (x1, h), (130, 130, 130), 2, cv2.LINE_AA)
    cv2.line(frame, (x2, 0), (x2, h), (130, 130, 130), 2, cv2.LINE_AA)

    labels = [("LEFT", int(w * 0.11)), ("CENTER", int(w * 0.43)), ("RIGHT", int(w * 0.77))]
    for label, x in labels:
        thickness = 4 if label == active_zone else 2
        cv2.putText(frame, label, (x, h - 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                    (255, 255, 255), thickness, cv2.LINE_AA)


def draw_ab(frame, a: np.ndarray, b: Optional[np.ndarray], a_xy, b_xy, relative_xy):
    ax, ay = int(round(a[0])), int(round(a[1]))
    cv2.circle(frame, (ax, ay), 10, (0, 255, 255), -1, cv2.LINE_AA)
    cv2.putText(frame, f"A Body abs=({a_xy[0]:.0f}, {a_xy[1]:.0f})",
                (ax + 14, max(25, ay - 12)), cv2.FONT_HERSHEY_SIMPLEX, 0.56,
                (0, 255, 255), 2, cv2.LINE_AA)

    if b is None or b_xy is None or relative_xy is None:
        return

    bx, by = int(round(b[0])), int(round(b[1]))
    cv2.circle(frame, (bx, by), 9, (0, 255, 0), -1, cv2.LINE_AA)
    cv2.putText(frame,
                f"B abs=({b_xy[0]:.0f},{b_xy[1]:.0f}) rel=({relative_xy[0]:.0f},{relative_xy[1]:.0f})",
                (bx + 14, max(25, by - 12)), cv2.FONT_HERSHEY_SIMPLEX, 0.50,
                (0, 255, 0), 2, cv2.LINE_AA)
    cv2.line(frame, (ax, ay), (bx, by), (255, 255, 255), 2, cv2.LINE_AA)


def draw_main_text(frame, body_zone: Optional[str], direction: Optional[str],
                   punch_visible: bool, guard_active: bool):
    h, w = frame.shape[:2]

    if body_zone:
        text = f"BODY: {body_zone}"
        size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1.15, 4)[0]
        cv2.putText(frame, text, ((w - size[0]) // 2, 52),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.15, (255, 255, 255), 4, cv2.LINE_AA)

    if direction:
        text = f"HAND: {direction}"
        size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1.15, 4)[0]
        cv2.putText(frame, text, ((w - size[0]) // 2, 100),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.15, (0, 255, 0), 4, cv2.LINE_AA)

    # A punch is an instant and a guard is a state, so they cannot collide on
    # the same line: the punch flashes over the top of a guard that is still up.
    if punch_visible:
        text = "PUNCH"
        size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1.55, 5)[0]
        cv2.putText(frame, text, ((w - size[0]) // 2, 155),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.55, (0, 0, 255), 5, cv2.LINE_AA)
    elif guard_active:
        text = "GUARD UP"
        size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1.55, 5)[0]
        cv2.putText(frame, text, ((w - size[0]) // 2, 155),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.55, (255, 200, 0), 5, cv2.LINE_AA)


def draw_debug(frame, pose_ok, fist_ok, body_zone, direction, relative_xy,
               distance_norm, approach_speed, state, fps, body_x, hand_x, hand_y,
               palm_distance, guard_state, guard_count, bridge):
    if bridge is None:
        link = "OFF"
    elif bridge.connected:
        link = f"CONNECTED ({bridge.sent} sent)"
    else:
        link = "WAITING FOR BRIDGE"

    lines = [
        f"Body pose: {'OK' if pose_ok else 'NOT FOUND'}",
        f"Right fist: {'OK' if fist_ok else 'NOT FOUND'}",
        f"Body zone: {body_zone if body_zone else '--'}",
        f"Hand direction: {direction if direction else '--'}",
        (f"B rel A: ({relative_xy[0]:.0f}, {relative_xy[1]:.0f})"
         if relative_xy is not None else "B rel A: --"),
        f"A-B distance: {distance_norm:.2f}" if distance_norm is not None else "A-B distance: --",
        f"Approach speed: {approach_speed:.2f}",
        f"Punch state: {state}",
        # The guard is this script's own call, not the game's, so the number it
        # is thresholding has to be readable next to the circle it draws.
        (f"Palm-A distance: {palm_distance:.2f} (guard <= {PUNCH_DISTANCE:.2f})"
         if palm_distance is not None else "Palm-A distance: --"),
        f"Guard: {guard_state} ({guard_count} raised)",
        # What the game actually receives, so a control that feels wrong can be
        # read off the same screen the tracking is checked on.
        (f"Game axes: body={body_x:+.2f} hand=({hand_x:+.2f}, {hand_y:+.2f})"
         if body_x is not None else "Game axes: --"),
        f"Bridge: {link}",
        f"FPS: {fps:.1f}",
        "Q quit | R reset",
    ]

    y = 25
    for line in lines:
        cv2.putText(frame, line, (16, y), cv2.FONT_HERSHEY_SIMPLEX, 0.47,
                    (255, 255, 255), 2, cv2.LINE_AA)
        y += 22


def parse_args():
    parser = argparse.ArgumentParser(description="LinguaPlay body zone + A/B punch + palm guard + chest-centered 4-direction detector")
    parser.add_argument("--camera", type=int, default=config.CAMERA_INDEX)
    parser.add_argument("--no-mirror", action="store_true")
    parser.add_argument("--bridge", default=DEFAULT_BRIDGE_URL,
                        help="Bridge endpoint that forwards tracking to the game.")
    parser.add_argument("--no-bridge", action="store_true",
                        help="Track and draw only, without feeding the game.")
    return parser.parse_args()


def main():
    args = parse_args()
    mirror = not args.no_mirror

    model_path = Path(config.MODEL_PATH)
    if not model_path.exists() or model_path.stat().st_size < 1_000_000:
        print("ERROR: MediaPipe model missing or incomplete:")
        print(model_path)
        return

    try:
        model_bytes = model_path.read_bytes()
    except OSError as exc:
        print("ERROR: Cannot read MediaPipe model:")
        print(exc)
        return

    cap = open_camera(args.camera)
    if not cap.isOpened():
        print(f"ERROR: Cannot open camera index {args.camera}.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.FRAME_HEIGHT)

    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_buffer=model_bytes),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=config.MIN_POSE_DETECTION_CONFIDENCE,
        min_pose_presence_confidence=config.MIN_POSE_PRESENCE_CONFIDENCE,
        min_tracking_confidence=config.MIN_TRACKING_CONFIDENCE,
        output_segmentation_masks=False,
    )

    chest_filter = PointEMA(CHEST_ALPHA)
    wrist_filter = PointEMA(WRIST_ALPHA)
    palm_filter = PointEMA(PALM_ALPHA)
    fps_filter = ScalarEMA(0.15)
    punch_detector = DistancePunchDetector()
    guard_detector = PalmGuardDetector()

    bridge = None if args.no_bridge else BridgeClient(args.bridge).start()

    start_t = time.perf_counter()
    last_loop_t = start_t
    last_timestamp_ms = -1
    last_punch_screen_t = -1e9
    # Monotonic, never reset: the game fires one punch per increment, so a
    # counter that went backwards would look like no punch at all. The guard is
    # counted the same way and for the same reason — the browser polls at 50 Hz
    # and a held guard would otherwise read as fifty blocks a second.
    punch_count = 0
    guard_count = 0

    print("=== LinguaPlay 4-Function CV ===")
    print("A = chest center")
    print("B = anatomical right wrist/fist")
    print("P = palm, the point the guard is judged on")
    print("Bottom-left = (0,0), +X right, +Y up")
    print("Body zones = LEFT | CENTER | RIGHT")
    print(f"READY distance >= {READY_DISTANCE:.2f}")
    print(f"PUNCH circle radius = {PUNCH_DISTANCE:.2f} shoulder widths")
    print(f"PUNCH text duration = {PUNCH_TEXT_DURATION_S:.2f} s")
    print(f"GUARD shares the PUNCH circle (radius = {PUNCH_DISTANCE:.2f} "
          f"shoulder widths), held {GUARD_DWELL_S:.2f} s")
    print("Hand direction = UP / DOWN / LEFT / RIGHT around moving chest origin")
    print(f"Bridge = {'disabled (--no-bridge)' if bridge is None else args.bridge}")

    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as landmarker:
            while True:
                ok, raw_frame = cap.read()
                if not ok or raw_frame is None:
                    print("ERROR: Cannot read camera frame.")
                    break

                now = time.perf_counter()
                fps = fps_filter.update(1.0 / max(now - last_loop_t, 1e-6))
                last_loop_t = now

                h, w = raw_frame.shape[:2]
                rgb = cv2.cvtColor(raw_frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                display = cv2.flip(raw_frame, 1) if mirror else raw_frame.copy()

                timestamp_ms = int((now - start_t) * 1000)
                if timestamp_ms <= last_timestamp_ms:
                    timestamp_ms = last_timestamp_ms + 1
                last_timestamp_ms = timestamp_ms

                result = landmarker.detect_for_video(mp_image, timestamp_ms)

                pose_ok = False
                fist_ok = False
                chest = None
                wrist = None
                palm = None
                a_xy = None
                b_xy = None
                body_zone = None
                direction = None
                relative_xy = None
                distance_norm = None
                palm_distance = None
                approach_speed = 0.0
                shoulder_width = None
                body_x = None
                hand_x = 0.0
                hand_y = 0.0

                if result.pose_landmarks:
                    lm = result.pose_landmarks[0]
                    l_sh = lm[LEFT_SHOULDER]
                    r_sh = lm[RIGHT_SHOULDER]
                    r_wr = lm[RIGHT_WRIST]

                    # A/body tracking only needs shoulders.
                    if visible(l_sh) and visible(r_sh):
                        pose_ok = True
                        left_shoulder = landmark_to_display_pixel(l_sh, w, h, mirror)
                        right_shoulder = landmark_to_display_pixel(r_sh, w, h, mirror)
                        shoulder_width = float(np.linalg.norm(left_shoulder - right_shoulder))

                        chest = chest_filter.update(chest_center(left_shoulder, right_shoulder))
                        a_xy = to_bottom_left_xy(chest, w, h)
                        body_zone = zone_from_x(chest[0], w)
                        body_x = body_axis(chest[0], w)

                        # B/punch can be lost without breaking body-zone detection.
                        if visible(r_wr):
                            fist_ok = True
                            raw_wrist = landmark_to_display_pixel(r_wr, w, h, mirror)
                            wrist = wrist_filter.update(raw_wrist)
                            b_xy = to_bottom_left_xy(wrist, w, h)
                            relative_xy = relative_to_chest_xy(chest, wrist)
                            hand_x, hand_y = hand_axes(relative_xy, shoulder_width)

                            # The palm is smoothed on its own rather than derived
                            # from the wrist above: the guard is a pose held for a
                            # fifth of a second, and wants the steadier filter.
                            r_idx = lm[RIGHT_INDEX]
                            r_pky = lm[RIGHT_PINKY]
                            palm = palm_filter.update(palm_center(
                                raw_wrist,
                                landmark_to_display_pixel(r_idx, w, h, mirror)
                                if visible(r_idx) else None,
                                landmark_to_display_pixel(r_pky, w, h, mirror)
                                if visible(r_pky) else None,
                            ))
                            palm_distance = (
                                float(np.linalg.norm(palm - chest))
                                / max(shoulder_width, 1.0)
                            )

                            distance_px = float(np.linalg.norm(wrist - chest))
                            distance_norm = distance_px / max(shoulder_width, 1.0)

                            direction = hand_direction(
                                relative_xy[0],
                                relative_xy[1],
                                distance_norm,
                            )

                            punch, approach_speed = punch_detector.update(
                                t=now - start_t,
                                distance_norm=distance_norm,
                            )

                            if punch:
                                last_punch_screen_t = now
                                punch_count += 1
                                print(
                                    f"PUNCH #{punch_count} | Body={body_zone} | "
                                    f"A={a_xy} | B={b_xy} | "
                                    f"distance={distance_norm:.2f}"
                                )
                        else:
                            wrist_filter.reset()
                            palm_filter.reset()

                # Called once a frame whatever the pose branch did, so a hand
                # that walks out of view drops the guard rather than leaving it
                # up on the last distance the camera happened to see.
                guard_active, guard_raised = guard_detector.update(
                    now - start_t,
                    palm_distance,
                )

                if guard_raised:
                    guard_count += 1
                    print(f"GUARD #{guard_count} | palm={palm_distance:.2f}")

                # Posted before drawing: the overlay is for the person standing
                # in front of the camera, but the game is waiting on this, and
                # rendering it first would put the whole draw cost in its path.
                if bridge is not None:
                    bridge.send({
                        "bodyX": body_x,
                        "zone": body_zone,
                        "handX": hand_x,
                        "handY": hand_y,
                        "direction": direction,
                        "punchCount": punch_count,
                        # Both, on purpose: the count is the event the game acts
                        # on, the flag is what a status light can mirror.
                        "guard": guard_active,
                        "guardCount": guard_count,
                        "state": punch_detector.state,
                        "guardState": guard_detector.state,
                        "poseOk": pose_ok,
                        "fistOk": fist_ok,
                        "fps": round(fps, 1),
                    })

                draw_zones(display, body_zone)
                draw_axes(display)

                if pose_ok and chest is not None and a_xy is not None:
                    draw_moving_chest_axes(display, chest)

                    if shoulder_width is not None:
                        draw_action_circle(
                            display,
                            chest,
                            shoulder_width,
                            wrist,
                            palm,
                            guard_active,
                        )

                    draw_ab(
                        display,
                        chest,
                        wrist,
                        a_xy,
                        b_xy,
                        relative_xy,
                    )

                punch_visible = (now - last_punch_screen_t) < PUNCH_TEXT_DURATION_S
                draw_main_text(display, body_zone, direction, punch_visible, guard_active)
                draw_debug(
                    display,
                    pose_ok,
                    fist_ok,
                    body_zone,
                    direction,
                    relative_xy,
                    distance_norm,
                    approach_speed,
                    punch_detector.state,
                    fps,
                    body_x,
                    hand_x,
                    hand_y,
                    palm_distance,
                    guard_detector.state,
                    guard_count,
                    bridge,
                )

                cv2.imshow("LinguaPlay - Body + Circular Punch + Palm Guard + 4 Direction", display)
                key = cv2.waitKey(1) & 0xFF

                if key == ord("q"):
                    break
                if key == ord("r"):
                    chest_filter.reset()
                    wrist_filter.reset()
                    palm_filter.reset()
                    punch_detector.reset()
                    # The guard *state* resets; guard_count deliberately does
                    # not, for the same reason punch_count does not.
                    guard_detector.reset()
                    last_punch_screen_t = -1e9
                    print("Detector reset.")

    finally:
        cap.release()
        cv2.destroyAllWindows()
        if bridge is not None:
            bridge.stop()

    print("Finished.")


if __name__ == "__main__":
    main()
