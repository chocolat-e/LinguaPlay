"""
LinguaPlay bridge - the one process the ESP32, the webcam, and the game talk to.

Three devices, four endpoints, one shared snapshot:

    ESP32        --POST /api/controller-->  bridge  --GET /api/input-->  browser
    webcam (CV)  --POST /api/vision------>  bridge
    browser      --POST /api/feedback---->  bridge  --(POST response)-->  ESP32

The feedback path is the part worth explaining. The ESP32 already POSTs its
state every 100 ms and throws the reply away, so the reply is a free channel
back to the hardware: no second connection, no polling loop on the device, and
the round trip is bounded by the push interval that already exists. The game
therefore never talks to the ESP32 directly - it drops a semantic event here
("correct", "blocked", "special") and the device collects it on its next push.

Mapping those events onto LED colours and buzzer tones lives in FEEDBACK below
rather than in the game, so the hardware can be re-tuned by editing this file
and restarting one Python process - no browser rebuild, no reflash.

Run:  python bridge.py            (listens on 0.0.0.0:5000)
"""

from __future__ import annotations

import argparse
import threading
import time
from typing import Any, Dict, Optional

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# A device is "online" if we have heard from it this recently.
#
# Deliberately generous. This is not a freshness measure - the game always reads
# the newest state it has - it is "is the device there at all", and going false
# has a real cost: the game re-arms its punch counters on a reconnect, so a
# controller that flickers offline for one slow push silently drops the punch
# that arrives next. A phone hotspot hiccups by more than a couple of push
# intervals, so the window has to cover that and still grey the UI out within a
# second of the controller actually being switched off.
ONLINE_TIMEOUT_S = 0.75

# The webcam runs at whatever frame rate the machine manages, which on a laptop
# under load can dip well below the controller's fixed cadence.
VISION_TIMEOUT_S = 0.60


def _now() -> float:
    return time.monotonic()


class DeviceState:
    """Last known state of one device, plus when it was last heard from.

    Every field the device sends is kept verbatim. The bridge deliberately does
    not validate or reshape them: the game already has to tolerate a field being
    absent (a controller flashed with older firmware, a CV script started with
    tracking disabled), so a schema here would only add a second place to fix
    when the firmware grows a field.
    """

    def __init__(self, timeout: float):
        self.data: Dict[str, Any] = {}
        self.timeout = timeout
        self.updated_at: float = -1e9
        self.packets = 0

    def update(self, payload: Dict[str, Any]) -> None:
        self.data.update(payload)
        self.updated_at = _now()
        self.packets += 1

    def snapshot(self) -> Dict[str, Any]:
        age = _now() - self.updated_at
        return {
            **self.data,
            "online": age <= self.timeout,
            "ageMs": round(age * 1000) if self.updated_at > -1e8 else None,
            "packets": self.packets,
        }


controller = DeviceState(ONLINE_TIMEOUT_S)
vision = DeviceState(VISION_TIMEOUT_S)

# One lock for all shared state. The handlers are microseconds long and Flask's
# threaded server is the only writer, so a single lock costs nothing and removes
# any question of a torn read between two fields of the same snapshot.
lock = threading.Lock()


# --------------------------------------------------------------- feedback --

# Semantic game event -> what the hardware should do about it.
#
# `led` is an RGB triple the firmware writes straight to its three pins, `buzz`
# is a tone in Hz (0 = silent) and `ms` how long to hold both. `text` is a short
# line for the OLED. Tuning any of these is a text edit and a restart.
FEEDBACK: Dict[str, Dict[str, Any]] = {
    "correct":   {"led": [0, 1, 0], "buzz": 880,  "ms": 90,  "text": "CORRECT"},
    "wrong":     {"led": [1, 0, 0], "buzz": 160,  "ms": 200, "text": "WRONG"},
    "miss":      {"led": [1, 1, 0], "buzz": 220,  "ms": 120, "text": "MISS"},
    "blocked":   {"led": [0, 0, 1], "buzz": 440,  "ms": 110, "text": "BLOCKED"},
    "hurt":      {"led": [1, 0, 0], "buzz": 110,  "ms": 260, "text": "HIT!"},
    "special":   {"led": [1, 0, 1], "buzz": 1320, "ms": 260, "text": "SPECIAL!"},
    "letter":    {"led": [0, 1, 1], "buzz": 990,  "ms": 60,  "text": "LETTER"},
    "collect":   {"led": [0, 1, 0], "buzz": 760,  "ms": 70,  "text": "PICKED UP"},
    "crash":     {"led": [1, 0, 0], "buzz": 130,  "ms": 180, "text": "CRASH"},
    "countdown": {"led": [1, 1, 0], "buzz": 660,  "ms": 80,  "text": "GET READY"},
    "start":     {"led": [0, 1, 0], "buzz": 1046, "ms": 150, "text": "FIGHT!"},
    "win":       {"led": [0, 1, 0], "buzz": 1318, "ms": 400, "text": "YOU WIN"},
    "lose":      {"led": [1, 0, 0], "buzz": 98,   "ms": 500, "text": "DEFEATED"},
}

# How much a given event deserves to survive being overwritten. Several events
# can land inside one 100 ms push window, and replaying a backlog would put the
# buzz behind the action it belongs to - so only one command is ever pending and
# the more significant event wins the slot.
PRIORITY: Dict[str, int] = {
    "letter": 1, "collect": 1, "countdown": 1,
    "miss": 2, "correct": 2, "blocked": 2, "crash": 2,
    "wrong": 3, "hurt": 3, "start": 3,
    "special": 4, "win": 5, "lose": 5,
}


class FeedbackSlot:
    """The single pending hardware command, and the running status line.

    `command` is one-shot: the ESP32 gets it exactly once, identified by `seq`,
    and flashes/buzzes. `status` is continuous - score, HP, combo - and is
    returned on every push so the OLED can simply mirror it.
    """

    def __init__(self) -> None:
        self.seq = 0
        self.command: Optional[Dict[str, Any]] = None
        self.priority = -1
        self.status: Dict[str, Any] = {}

    def put(self, kind: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        priority = PRIORITY.get(kind, 2)
        if self.command is None or priority >= self.priority:
            # The payload may override any mapped field, so the game can send a
            # louder buzz for a bigger hit without a new event kind.
            base = dict(FEEDBACK.get(kind, FEEDBACK["correct"]))
            base.update({k: v for k, v in payload.items() if k in ("led", "buzz", "ms", "text")})
            base["kind"] = kind
            self.seq += 1
            base["seq"] = self.seq
            self.command = base
            self.priority = priority
        # Status fields ride along with any event and are never dropped.
        for key in ("score", "hp", "monsterHp", "combo", "level", "state", "question"):
            if key in payload:
                self.status[key] = payload[key]
        return self.command or {}

    def take(self) -> Optional[Dict[str, Any]]:
        command = self.command
        self.command = None
        self.priority = -1
        return command


feedback = FeedbackSlot()


# -------------------------------------------------------------- endpoints --

@app.post("/api/controller")
def receive_controller():
    """The ESP32 pushes its state here, and collects its LED/buzzer/OLED work."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Invalid JSON"}), 400

    with lock:
        controller.update(payload)
        command = feedback.take()
        status = dict(feedback.status)

    return jsonify({"ok": True, "cmd": command, "status": status})


@app.post("/api/vision")
def receive_vision():
    """The computer-vision script pushes body position, reach, and punches."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Invalid JSON"}), 400

    with lock:
        vision.update(payload)

    return jsonify({"ok": True})


@app.get("/api/input")
def get_input():
    """One merged snapshot for the browser. The only endpoint the game polls."""
    with lock:
        return jsonify({
            "now": round(_now() * 1000, 1),
            "controller": controller.snapshot(),
            "vision": vision.snapshot(),
        })


@app.post("/api/feedback")
def post_feedback():
    """The game announces what just happened; the ESP32 picks it up next push."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Invalid JSON"}), 400

    kind = str(payload.get("kind", "correct"))
    with lock:
        command = feedback.put(kind, payload)

    return jsonify({"ok": True, "cmd": command})


@app.get("/api/health")
def health():
    with lock:
        return jsonify({
            "ok": True,
            "controller": controller.snapshot(),
            "vision": vision.snapshot(),
            "kinds": sorted(FEEDBACK),
        })


# The ESP32 firmware in this repo has always posted to /api/controller, and the
# old server also served it on GET. Kept so a controller flashed with older
# firmware, or a curl while debugging, still works.
@app.get("/api/controller")
def get_controller():
    with lock:
        return jsonify(controller.snapshot())


def main() -> None:
    parser = argparse.ArgumentParser(description="LinguaPlay device bridge")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    print("=== LinguaPlay bridge ===")
    print(f"  ESP32   POST http://<this-machine>:{args.port}/api/controller")
    print(f"  Vision  POST http://127.0.0.1:{args.port}/api/vision")
    print(f"  Game    GET  http://127.0.0.1:{args.port}/api/input")

    # Served by waitress rather than Flask's development server, for one
    # specific reason: Werkzeug answers every request with `Connection: close`.
    # The ESP32 asks to keep the socket open, so on the dev server it pays a
    # fresh TCP handshake on every push - about 170 ms over a phone hotspot,
    # which throttles the controller to under 6 pushes a second and puts that
    # much lag in front of every punch. waitress speaks HTTP/1.1 keep-alive, so
    # the connection the firmware opens is the one it keeps using.
    try:
        from waitress import serve
    except ImportError:
        print()
        print("  ! waitress is not installed, falling back to the Flask dev server.")
        print("    The controller will still work, but every push reconnects and")
        print("    punches arrive late.  Fix with:  pip install waitress")
        print()
        # debug=False on purpose: the reloader would run this module twice and
        # give the two copies separate device state, so the game would poll a
        # snapshot the devices are not writing to.
        app.run(host=args.host, port=args.port, threaded=True, debug=False)
        return

    print("  (waitress, HTTP/1.1 keep-alive)")
    print()
    serve(app, host=args.host, port=args.port, threads=8, clear_untrusted_proxy_headers=True)


if __name__ == "__main__":
    main()
