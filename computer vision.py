"""
A/B point tracker for the boxing language-learning project.

Purpose
-------
A = chest center
B = right wrist

Only A and B are drawn on the video.
Shoulder/elbow landmarks, arm lines, punch-direction text, and body-centered
XY axes are NOT displayed.

Coordinate system
-----------------
The DISPLAY WINDOW bottom-left corner is fixed at (0, 0).

    +Y
     ^
     |
     |
(0,0) --------> +X

Coordinates are display-pixel coordinates:
    X increases to the right.
    Y increases upward.

The webcam is mirrored by default so movement on screen feels natural.
MediaPipe still analyzes the original frame, so RIGHT_WRIST remains the
player's anatomical right wrist.

Keyboard
--------
Q = quit
R = reset point smoothing

Examples
--------
python boxing_cv_AB_window_xy.py
python boxing_cv_AB_window_xy.py --camera 1
python boxing_cv_AB_window_xy.py --no-mirror
python boxing_cv_AB_window_xy.py --record
"""

from __future__ import annotations

import argparse
import csv
import platform
import time
from pathlib import Path
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np

import config


# ---------------------------------------------------------------------
# MediaPipe landmark indices
# ---------------------------------------------------------------------

LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
RIGHT_WRIST = 16


# ---------------------------------------------------------------------
# Tracking / display settings
# ---------------------------------------------------------------------

# A smaller alpha = smoother but slower.
# Chest should be stable, while wrist should react faster to punches.
CHEST_SMOOTHING_ALPHA = 0.30
WRIST_SMOOTHING_ALPHA = 0.55

POINT_RADIUS = 9
ORIGIN_AXIS_LENGTH = 85


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

class PointEMA:
    """Exponential moving average for a 2D point."""

    def __init__(self, alpha: float):
        self.alpha = float(alpha)
        self.value: Optional[np.ndarray] = None

    def update(self, point: np.ndarray) -> np.ndarray:
        point = np.asarray(point, dtype=np.float32)

        if self.value is None:
            self.value = point.copy()
        else:
            self.value = (
                self.alpha * point
                + (1.0 - self.alpha) * self.value
            )

        return self.value.copy()

    def reset(self):
        self.value = None


class ScalarEMA:
    """EMA used only for a smoother FPS display."""

    def __init__(self, alpha: float):
        self.alpha = float(alpha)
        self.value: Optional[float] = None

    def update(self, value: float) -> float:
        value = float(value)

        if self.value is None:
            self.value = value
        else:
            self.value = (
                self.alpha * value
                + (1.0 - self.alpha) * self.value
            )

        return float(self.value)


def visible(lm) -> bool:
    """Check MediaPipe visibility against project config."""
    visibility = getattr(lm, "visibility", 1.0)

    if visibility is None:
        return True

    return float(visibility) >= config.MIN_VISIBILITY


def open_camera(index: int):
    """Open camera with DirectShow first on Windows."""
    if platform.system() == "Windows":
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)

        if cap.isOpened():
            return cap

        cap.release()

    return cv2.VideoCapture(index)


def landmark_to_display_pixel(
    lm,
    width: int,
    height: int,
    mirror: bool,
) -> np.ndarray:
    """
    Convert MediaPipe normalized coordinates to DISPLAY pixel coordinates.

    OpenCV display pixel coordinates still use:
        top-left = (0, 0)
        +x right
        +y down
    """
    x_norm = 1.0 - float(lm.x) if mirror else float(lm.x)
    y_norm = float(lm.y)

    return np.array(
        [
            x_norm * width,
            y_norm * height,
        ],
        dtype=np.float32,
    )


def calculate_chest_center(
    left_shoulder: np.ndarray,
    right_shoulder: np.ndarray,
) -> np.ndarray:
    """
    Estimate chest/sternum center from the two shoulders.

    Step 1: midpoint between shoulders.
    Step 2: move slightly downward by 28% of shoulder width.

    This gives a practical chest point while only requiring the upper body.
    """
    shoulder_mid = (
        left_shoulder + right_shoulder
    ) * 0.5

    shoulder_width = float(
        np.linalg.norm(
            left_shoulder - right_shoulder
        )
    )

    chest = shoulder_mid.copy()

    # Display coordinate +Y is downward.
    chest[1] += 0.28 * shoulder_width

    return chest


def display_to_window_xy(
    display_point: np.ndarray,
    width: int,
    height: int,
) -> tuple[float, float]:
    """
    Convert OpenCV DISPLAY coordinates to requested window coordinates.

    OpenCV:
        origin = top-left
        +Y = down

    Requested:
        origin = bottom-left
        +Y = up
    """
    x = float(display_point[0])
    y = float(height) - float(display_point[1])

    x = max(0.0, min(float(width), x))
    y = max(0.0, min(float(height), y))

    return x, y


def draw_window_origin(frame):
    """
    Draw only a small coordinate reference at the WINDOW bottom-left.
    This is not a body tracking point.
    """
    h, w = frame.shape[:2]

    # OpenCV screen location corresponding to requested (0,0).
    origin = (0, h - 1)

    axis_color = (210, 210, 210)

    # +X axis
    cv2.arrowedLine(
        frame,
        origin,
        (min(w - 1, ORIGIN_AXIS_LENGTH), h - 1),
        axis_color,
        2,
        cv2.LINE_AA,
        tipLength=0.12,
    )

    # +Y axis
    cv2.arrowedLine(
        frame,
        origin,
        (0, max(0, h - 1 - ORIGIN_AXIS_LENGTH)),
        axis_color,
        2,
        cv2.LINE_AA,
        tipLength=0.12,
    )

    cv2.putText(
        frame,
        "(0,0)",
        (8, h - 12),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        axis_color,
        2,
        cv2.LINE_AA,
    )

    cv2.putText(
        frame,
        "+X",
        (ORIGIN_AXIS_LENGTH + 8, h - 12),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        axis_color,
        2,
        cv2.LINE_AA,
    )

    cv2.putText(
        frame,
        "+Y",
        (8, max(25, h - ORIGIN_AXIS_LENGTH - 8)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        axis_color,
        2,
        cv2.LINE_AA,
    )


def draw_tracking_point(
    frame,
    point: np.ndarray,
    label: str,
    xy: tuple[float, float],
):
    """
    Draw one tracked point and its window coordinate.
    Only A and B use this function.
    """
    h, w = frame.shape[:2]

    px = int(round(float(point[0])))
    py = int(round(float(point[1])))

    px = max(0, min(w - 1, px))
    py = max(0, min(h - 1, py))

    cv2.circle(
        frame,
        (px, py),
        POINT_RADIUS,
        (0, 255, 255),
        -1,
        cv2.LINE_AA,
    )

    text = (
        f"{label} "
        f"({xy[0]:.0f}, {xy[1]:.0f})"
    )

    # Keep text inside the window.
    tx = min(max(px + 14, 8), max(8, w - 220))
    ty = min(max(py - 14, 25), h - 10)

    cv2.putText(
        frame,
        text,
        (tx, ty),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.62,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )


def draw_status(
    frame,
    pose_ok: bool,
    a_xy: Optional[tuple[float, float]],
    b_xy: Optional[tuple[float, float]],
    fps: float,
    mirror: bool,
):
    """Minimal status panel. No punch direction / shoulder / elbow data."""
    lines = [
        f"Pose: {'OK' if pose_ok else 'NOT FOUND'}",
        f"Mirror: {'ON' if mirror else 'OFF'}",
        (
            f"A chest: ({a_xy[0]:.0f}, {a_xy[1]:.0f})"
            if a_xy is not None
            else "A chest: --"
        ),
        (
            f"B right wrist: ({b_xy[0]:.0f}, {b_xy[1]:.0f})"
            if b_xy is not None
            else "B right wrist: --"
        ),
        f"FPS: {fps:.1f}",
        "Q quit | R reset smoothing",
    ]

    y = 28

    for line in lines:
        cv2.putText(
            frame,
            line,
            (18, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.56,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        y += 26


def make_csv():
    """Optional recording of A/B window coordinates."""
    config.DATA_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = (
        config.DATA_DIR
        / f"AB_positions_{time.strftime('%Y%m%d_%H%M%S')}.csv"
    )

    f = path.open(
        "w",
        newline="",
        encoding="utf-8-sig",
    )

    writer = csv.writer(f)

    writer.writerow(
        [
            "time_s",
            "A_chest_x",
            "A_chest_y",
            "B_wrist_x",
            "B_wrist_y",
            "pose_ok",
        ]
    )

    return path, f, writer


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Track A=chest and B=right wrist "
            "using bottom-left window origin."
        )
    )

    parser.add_argument(
        "--camera",
        type=int,
        default=config.CAMERA_INDEX,
    )

    parser.add_argument(
        "--no-mirror",
        action="store_true",
        help="Disable mirror display. Mirror is ON by default.",
    )

    parser.add_argument(
        "--record",
        action="store_true",
        help="Record A/B coordinates to CSV.",
    )

    return parser.parse_args()


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main():
    args = parse_args()

    mirror = not args.no_mirror

    model_path = Path(config.MODEL_PATH)

    if (
        not model_path.exists()
        or not model_path.is_file()
        or model_path.stat().st_size < 1_000_000
    ):
        print(
            "ERROR: MediaPipe model is missing or incomplete:"
        )
        print(model_path)
        print("Run FIX_MODEL.bat and try again.")
        return

    # Read into memory to avoid Unicode path issues on Windows.
    try:
        model_bytes = model_path.read_bytes()
    except OSError as exc:
        print("ERROR: Cannot read MediaPipe model.")
        print(exc)
        return

    cap = open_camera(args.camera)

    if not cap.isOpened():
        print(
            f"ERROR: Cannot open camera index {args.camera}."
        )
        print(
            "Try: python boxing_cv_AB_window_xy.py --camera 1"
        )
        return

    cap.set(
        cv2.CAP_PROP_FRAME_WIDTH,
        config.FRAME_WIDTH,
    )
    cap.set(
        cv2.CAP_PROP_FRAME_HEIGHT,
        config.FRAME_HEIGHT,
    )

    BaseOptions = mp.tasks.BaseOptions
    PoseLandmarker = mp.tasks.vision.PoseLandmarker
    PoseLandmarkerOptions = (
        mp.tasks.vision.PoseLandmarkerOptions
    )
    RunningMode = mp.tasks.vision.RunningMode

    options = PoseLandmarkerOptions(
        base_options=BaseOptions(
            model_asset_buffer=model_bytes
        ),
        running_mode=RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=(
            config.MIN_POSE_DETECTION_CONFIDENCE
        ),
        min_pose_presence_confidence=(
            config.MIN_POSE_PRESENCE_CONFIDENCE
        ),
        min_tracking_confidence=(
            config.MIN_TRACKING_CONFIDENCE
        ),
        output_segmentation_masks=False,
    )

    chest_filter = PointEMA(
        CHEST_SMOOTHING_ALPHA
    )

    wrist_filter = PointEMA(
        WRIST_SMOOTHING_ALPHA
    )

    fps_filter = ScalarEMA(0.15)

    csv_path = None
    csv_file = None
    csv_writer = None

    if args.record:
        (
            csv_path,
            csv_file,
            csv_writer,
        ) = make_csv()

    start_t = time.perf_counter()
    last_loop_t = start_t
    last_timestamp_ms = -1

    print("=== A/B Window Coordinate Tracker ===")
    print("A = chest center")
    print("B = anatomical RIGHT wrist")
    print("Window bottom-left = (0,0)")
    print("+X = right")
    print("+Y = up")
    print(
        f"Mirror: {'ON' if mirror else 'OFF'}"
    )
    print(
        f"Camera: {args.camera}"
    )

    if csv_path is not None:
        print(
            f"CSV recording: {csv_path}"
        )

    print(
        "Stand far enough back that both shoulders "
        "and your right wrist are visible."
    )
    print(
        "Press Q to quit. Press R to reset smoothing."
    )

    try:
        with PoseLandmarker.create_from_options(
            options
        ) as landmarker:

            while True:
                ok, raw_frame = cap.read()

                if (
                    not ok
                    or raw_frame is None
                ):
                    print(
                        "ERROR: Camera frame could not be read."
                    )
                    break

                now = time.perf_counter()

                dt = max(
                    now - last_loop_t,
                    1e-6,
                )

                fps = fps_filter.update(
                    1.0 / dt
                )

                last_loop_t = now

                h, w = raw_frame.shape[:2]

                # MediaPipe analyzes original frame.
                rgb = cv2.cvtColor(
                    raw_frame,
                    cv2.COLOR_BGR2RGB,
                )

                mp_image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=rgb,
                )

                # User sees mirrored frame by default.
                display_frame = (
                    cv2.flip(raw_frame, 1)
                    if mirror
                    else raw_frame.copy()
                )

                timestamp_ms = int(
                    (now - start_t) * 1000
                )

                if (
                    timestamp_ms
                    <= last_timestamp_ms
                ):
                    timestamp_ms = (
                        last_timestamp_ms + 1
                    )

                last_timestamp_ms = timestamp_ms

                result = landmarker.detect_for_video(
                    mp_image,
                    timestamp_ms,
                )

                pose_ok = False
                a_xy = None
                b_xy = None

                if result.pose_landmarks:
                    lm = result.pose_landmarks[0]

                    left_sh_lm = lm[
                        LEFT_SHOULDER
                    ]

                    right_sh_lm = lm[
                        RIGHT_SHOULDER
                    ]

                    right_wrist_lm = lm[
                        RIGHT_WRIST
                    ]

                    needed = [
                        left_sh_lm,
                        right_sh_lm,
                        right_wrist_lm,
                    ]

                    if all(
                        visible(x)
                        for x in needed
                    ):
                        pose_ok = True

                        left_shoulder = (
                            landmark_to_display_pixel(
                                left_sh_lm,
                                w,
                                h,
                                mirror,
                            )
                        )

                        right_shoulder = (
                            landmark_to_display_pixel(
                                right_sh_lm,
                                w,
                                h,
                                mirror,
                            )
                        )

                        right_wrist = (
                            landmark_to_display_pixel(
                                right_wrist_lm,
                                w,
                                h,
                                mirror,
                            )
                        )

                        # A = moving chest center.
                        chest_raw = (
                            calculate_chest_center(
                                left_shoulder,
                                right_shoulder,
                            )
                        )

                        # Smooth tracked points.
                        chest = chest_filter.update(
                            chest_raw
                        )

                        wrist = wrist_filter.update(
                            right_wrist
                        )

                        # Convert to bottom-left window XY.
                        a_xy = display_to_window_xy(
                            chest,
                            w,
                            h,
                        )

                        b_xy = display_to_window_xy(
                            wrist,
                            w,
                            h,
                        )

                        # Only two tracking points are drawn.
                        draw_tracking_point(
                            display_frame,
                            chest,
                            "A",
                            a_xy,
                        )

                        draw_tracking_point(
                            display_frame,
                            wrist,
                            "B",
                            b_xy,
                        )

                # Fixed window coordinate reference only.
                # No body-centered axes are drawn.
                draw_window_origin(
                    display_frame
                )

                draw_status(
                    display_frame,
                    pose_ok,
                    a_xy,
                    b_xy,
                    fps,
                    mirror,
                )

                if (
                    csv_writer is not None
                ):
                    if pose_ok:
                        csv_writer.writerow(
                            [
                                round(
                                    now - start_t,
                                    4,
                                ),
                                round(
                                    a_xy[0],
                                    2,
                                ),
                                round(
                                    a_xy[1],
                                    2,
                                ),
                                round(
                                    b_xy[0],
                                    2,
                                ),
                                round(
                                    b_xy[1],
                                    2,
                                ),
                                1,
                            ]
                        )
                    else:
                        csv_writer.writerow(
                            [
                                round(
                                    now - start_t,
                                    4,
                                ),
                                "",
                                "",
                                "",
                                "",
                                0,
                            ]
                        )

                cv2.imshow(
                    "Boxing CV - A Chest / B Right Wrist",
                    display_frame,
                )

                key = (
                    cv2.waitKey(1)
                    & 0xFF
                )

                if key == ord("q"):
                    break

                if key == ord("r"):
                    chest_filter.reset()
                    wrist_filter.reset()
                    print(
                        "Point smoothing reset."
                    )

    finally:
        cap.release()
        cv2.destroyAllWindows()

        if csv_file is not None:
            csv_file.close()

    print("Finished.")


if __name__ == "__main__":
    main()
