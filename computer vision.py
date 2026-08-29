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

# MediaPipe Pose landmarks
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
RIGHT_WRIST = 16

# Smoothing
CHEST_ALPHA = 0.32
WRIST_ALPHA = 0.55

# Punch tuning: distance is normalized by shoulder width.
READY_DISTANCE = 1.20       # B must first move outside the punch circle
PUNCH_DISTANCE = 0.95       # circular punch-zone radius in shoulder widths
MIN_APPROACH_SPEED = 0.45   # normalized-distance decrease per second
PUNCH_COOLDOWN_S = 0.65
PUNCH_TEXT_DURATION_S = 0.45

# Hand direction: B must be this far from A before UP/DOWN/LEFT/RIGHT is shown.
HAND_DIRECTION_MIN_DISTANCE = 0.55


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



def draw_punch_circle(
    frame,
    chest: np.ndarray,
    shoulder_width: float,
    wrist: Optional[np.ndarray],
):
    """
    Draw the circular PUNCH detection zone.

    Circle center:
        A = chest

    Circle radius:
        shoulder_width * PUNCH_DISTANCE

    If B is inside the circle, it is inside the punch-detection region.
    The actual PUNCH event still requires:
        READY -> moving toward A -> entering this circle.
    """
    h, w = frame.shape[:2]

    cx = int(round(float(chest[0])))
    cy = int(round(float(chest[1])))

    radius = int(
        round(
            max(
                10.0,
                shoulder_width * PUNCH_DISTANCE,
            )
        )
    )

    # Clamp radius to avoid absurd drawing values.
    radius = min(
        radius,
        max(w, h),
    )

    # Circle boundary.
    cv2.circle(
        frame,
        (cx, cy),
        radius,
        (0, 165, 255),
        2,
        cv2.LINE_AA,
    )

    # Label.
    label_y = max(
        24,
        cy - radius - 8,
    )

    cv2.putText(
        frame,
        "PUNCH ZONE",
        (max(5, cx - 58), label_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        (0, 165, 255),
        2,
        cv2.LINE_AA,
    )

    # Optional small indicator showing whether B is currently inside.
    if wrist is not None:
        distance_px = float(
            np.linalg.norm(
                wrist - chest
            )
        )

        inside = (
            distance_px <= radius
        )

        status = (
            "B INSIDE"
            if inside
            else "B OUTSIDE"
        )

        cv2.putText(
            frame,
            status,
            (
                max(5, cx - 48),
                min(h - 10, cy + radius + 22),
            ),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (0, 165, 255),
            2,
            cv2.LINE_AA,
        )


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


def draw_main_text(frame, body_zone: Optional[str], direction: Optional[str], punch_visible: bool):
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

    if punch_visible:
        text = "PUNCH"
        size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1.55, 5)[0]
        cv2.putText(frame, text, ((w - size[0]) // 2, 155),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.55, (0, 0, 255), 5, cv2.LINE_AA)


def draw_debug(frame, pose_ok, fist_ok, body_zone, direction, relative_xy,
               distance_norm, approach_speed, state, fps):
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
        f"FPS: {fps:.1f}",
        "Q quit | R reset",
    ]

    y = 25
    for line in lines:
        cv2.putText(frame, line, (16, y), cv2.FONT_HERSHEY_SIMPLEX, 0.47,
                    (255, 255, 255), 2, cv2.LINE_AA)
        y += 22


def parse_args():
    parser = argparse.ArgumentParser(description="LinguaPlay body zone + A/B punch + chest-centered 4-direction detector")
    parser.add_argument("--camera", type=int, default=config.CAMERA_INDEX)
    parser.add_argument("--no-mirror", action="store_true")
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
    fps_filter = ScalarEMA(0.15)
    punch_detector = DistancePunchDetector()

    start_t = time.perf_counter()
    last_loop_t = start_t
    last_timestamp_ms = -1
    last_punch_screen_t = -1e9

    print("=== LinguaPlay 3-Function CV ===")
    print("A = chest center")
    print("B = anatomical right wrist/fist")
    print("Bottom-left = (0,0), +X right, +Y up")
    print("Body zones = LEFT | CENTER | RIGHT")
    print(f"READY distance >= {READY_DISTANCE:.2f}")
    print(f"PUNCH circle radius = {PUNCH_DISTANCE:.2f} shoulder widths")
    print(f"PUNCH text duration = {PUNCH_TEXT_DURATION_S:.2f} s")
    print("Hand direction = UP / DOWN / LEFT / RIGHT around moving chest origin")

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
                a_xy = None
                b_xy = None
                body_zone = None
                direction = None
                relative_xy = None
                distance_norm = None
                approach_speed = 0.0
                shoulder_width = None

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

                        # B/punch can be lost without breaking body-zone detection.
                        if visible(r_wr):
                            fist_ok = True
                            wrist = wrist_filter.update(
                                landmark_to_display_pixel(r_wr, w, h, mirror)
                            )
                            b_xy = to_bottom_left_xy(wrist, w, h)
                            relative_xy = relative_to_chest_xy(chest, wrist)

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
                                print(
                                    f"PUNCH | Body={body_zone} | "
                                    f"A={a_xy} | B={b_xy} | "
                                    f"distance={distance_norm:.2f}"
                                )
                        else:
                            wrist_filter.reset()

                draw_zones(display, body_zone)
                draw_axes(display)

                if pose_ok and chest is not None and a_xy is not None:
                    draw_moving_chest_axes(display, chest)

                    if shoulder_width is not None:
                        draw_punch_circle(
                            display,
                            chest,
                            shoulder_width,
                            wrist,
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
                draw_main_text(display, body_zone, direction, punch_visible)
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
                )

                cv2.imshow("LinguaPlay - Body + Circular Punch + 4 Direction", display)
                key = cv2.waitKey(1) & 0xFF

                if key == ord("q"):
                    break
                if key == ord("r"):
                    chest_filter.reset()
                    wrist_filter.reset()
                    punch_detector.reset()
                    last_punch_screen_t = -1e9
                    print("Detector reset.")

    finally:
        cap.release()
        cv2.destroyAllWindows()

    print("Finished.")


if __name__ == "__main__":
    main()
