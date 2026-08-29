from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "pose_landmarker_lite.task"
DATA_DIR = BASE_DIR / "data"
EVENT_DIR = BASE_DIR / "events"

# Camera
CAMERA_INDEX = 0
FRAME_WIDTH = 1280
FRAME_HEIGHT = 720

# Which hand is used for boxing: "RIGHT" or "LEFT"
SIDE = "RIGHT"

# Pose landmark confidence
MIN_VISIBILITY = 0.50
MIN_POSE_DETECTION_CONFIDENCE = 0.50
MIN_POSE_PRESENCE_CONFIDENCE = 0.50
MIN_TRACKING_CONFIDENCE = 0.50

# Punch detector starting thresholds.
# These are intentionally easy-to-understand prototype values and should
# be calibrated with your own participants later.
READY_ANGLE_DEG = 115.0
PUNCH_ANGLE_DEG = 155.0
MIN_ANGLE_VELOCITY_DEG_S = 90.0
MIN_WRIST_SPEED_SHOULDER_WIDTHS_S = 0.55
COOLDOWN_S = 0.40

# Exponential moving-average smoothing factor. 0 = very smooth/slow,
# 1 = no smoothing. Values around 0.35-0.50 work well for webcams.
SMOOTHING_ALPHA = 0.40

# Screen zones used as a simple game-facing output.
LEFT_ZONE_MAX_X = 0.40
RIGHT_ZONE_MIN_X = 0.60

# Local UDP event output. A game running on the same computer can listen
# on this port and receive JSON punch events.
UDP_HOST = "127.0.0.1"
UDP_PORT = 5005
ENABLE_UDP = True
