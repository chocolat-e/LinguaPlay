"""
Hardware bring-up tool: what the bridge is actually hearing, and what it can say.

Bringing up a controller fails in ways that all look identical from the game -
nothing happens. This separates them: whether packets arrive at all, whether the
firmware is the version that sends counters, whether the accelerometer is
mounted the way the tilt maths assumes, and whether a punch is crossing the
detection threshold.

    python hwtest.py                 watch the devices, one line per real change
    python hwtest.py --check         one-shot report: what is connected and sane
    python hwtest.py --feedback win  fire one command at the controller
    python hwtest.py --sequence      every LED/buzzer command in turn

Run `bridge.py` first. The game does not need to be running.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5000"

# Matches STANCE_X / STANCE_TOLERANCE in the game's constants: outside a lane
# and inside neither is a real state, and the game treats a punch from there as
# a miss rather than guessing the nearer answer.
def lane_of(axis: float | None) -> str:
    if axis is None:
        return "--"
    if axis <= -0.58:
        return "LEFT"
    if axis >= 0.58:
        return "RIGHT"
    if -0.42 <= axis <= 0.42:
        return "CENTER"
    return "between"


def get(path: str):
    with urllib.request.urlopen(BASE + path, timeout=3) as r:
        return json.loads(r.read())


def post(path: str, payload: dict):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=3) as r:
        return json.loads(r.read())


def require_bridge() -> bool:
    try:
        get("/api/health")
        return True
    except (urllib.error.URLError, OSError) as exc:
        print(f"Cannot reach the bridge at {BASE} ({exc}).")
        print("Start it first:  python bridge.py")
        return False


# --------------------------------------------------------------- one-shot --

def check() -> None:
    """A report on what is connected, and what looks wrong about it."""
    snapshot = get("/api/input")
    controller = snapshot["controller"]
    vision = snapshot["vision"]

    print("=== CONTROLLER (ESP32) ===")
    if not controller.get("online"):
        print("  OFFLINE - nothing arriving.")
        if controller.get("packets"):
            print(f"  {controller['packets']} packets did arrive earlier, so the wiring is")
            print("  right and it has since stopped: check WiFi, or that it is still powered.")
        else:
            print("  Never heard from. Check, in this order:")
            print("    - API_URL in controller.ino is this PC's IPv4 address (run ipconfig)")
            print("    - the ESP32 and this PC are on the same 2.4 GHz network")
            print("    - the serial monitor shows 'WiFi connected' and an IP")
            print("    - Windows Firewall is not blocking python.exe on port 5000")
    else:
        print(f"  ONLINE   last packet {controller.get('ageMs')} ms ago, "
              f"{controller.get('packets')} total")
        # joy and button drive the menus only; tilt and punchPower are the two
        # that reach the fight.
        print(f"  action={controller.get('action')}  joy={controller.get('joy')}  "
              f"button={controller.get('button')}   (both menu-only)")
        print(f"  tilt={controller.get('tilt')}  -> lane {lane_of(controller.get('tilt'))}")
        print(f"  punchPower={controller.get('punchPower')}  "
              f"accPower={controller.get('accPower')}")

        if "punchCount" not in controller:
            print()
            print("  ! No punchCount field. This is the OLD firmware.")
            print("    The game falls back to reading the rise into action=PUNCH, which")
            print("    works, but reflashing controller.ino gives more reliable punches.")
        else:
            print(f"  punchCount={controller['punchCount']}  "
                  f"buttonCount={controller.get('buttonCount')}")

        if "tilt" not in controller:
            print("  ! No tilt field - steering will not work. Reflash controller.ino.")
        elif controller.get("tilt") == 0:
            print("  note: tilt is exactly 0. Correct if the board is level; if it stays")
            print("        0 while you roll your wrist, swap ay/az in updateTilt().")

    print()
    print("=== VISION (webcam) ===")
    if not vision.get("online"):
        print("  OFFLINE - nothing arriving.")
        print("  Start it:  python \"computer vision.py\"")
        print("  If it exits complaining about the model, run FIX_MODEL.bat first.")
    else:
        body = vision.get("bodyX")
        print(f"  ONLINE   last packet {vision.get('ageMs')} ms ago, "
              f"{vision.get('packets')} total, {vision.get('fps')} fps")
        print(f"  poseOk={vision.get('poseOk')}  fistOk={vision.get('fistOk')}")
        print(f"  bodyX={body}  -> lane {lane_of(body)}  (script says {vision.get('zone')})")
        print(f"  hand=({vision.get('handX')}, {vision.get('handY')})  "
              f"direction={vision.get('direction')}")
        print(f"  punchCount={vision.get('punchCount')}  state={vision.get('state')}")
        print(f"  guard={vision.get('guard')}  guardCount={vision.get('guardCount')}  "
              f"guardState={vision.get('guardState')}")

        if "guardCount" not in vision:
            print()
            print("  ! No guardCount field. This is an OLD 'computer vision.py'.")
            print("    Blocking is a camera gesture now - the palm brought back inside")
            print("    the circle on your chest - so without it nothing can block.")

        if vision.get("poseOk") is False:
            print()
            print("  ! No pose detected. Stand 2-3 m from the camera in a well-lit room,")
            print("    with both shoulders in frame.")

    print()
    if controller.get("online") or vision.get("online"):
        print("At least one device is live. Open the game - the menu should show it.")
    else:
        print("Neither device is live. The game still runs on the keyboard.")


# ------------------------------------------------------------------ watch --

def watch() -> None:
    """One line per meaningful change, so a real punch is visible as an event."""
    print("Watching. Punch, guard (palm to your chest), lean, move around,")
    print("and press the button and stick to check the menu controls.")
    print("Ctrl+C to stop.\n")

    previous: dict = {}
    counters = {
        "controller_punch": None,
        "vision_punch": None,
        "vision_guard": None,
        "button": None,
    }
    rate_at = time.monotonic()
    rate_base = {"controller": 0, "vision": 0}

    while True:
        try:
            snapshot = get("/api/input")
        except (urllib.error.URLError, OSError):
            print("bridge unreachable")
            time.sleep(1)
            continue

        now = time.strftime("%H:%M:%S")

        for name in ("controller", "vision"):
            device = snapshot[name]
            was = previous.get(name, {})
            if device.get("online") != was.get("online"):
                state = "ONLINE" if device.get("online") else "OFFLINE"
                print(f"[{now}] {name.upper():10} {state}")

        controller = snapshot["controller"]
        vision = snapshot["vision"]

        # Counters are the events that matter: one increment is one real action.
        for key, device, field, label in (
            ("controller_punch", controller, "punchCount", "PUNCH  (controller)"),
            ("vision_punch", vision, "punchCount", "PUNCH  (camera)"),
            ("vision_guard", vision, "guardCount", "GUARD  (camera)"),
            ("button", controller, "buttonCount", "BUTTON (menu select)"),
        ):
            value = device.get(field)
            if not isinstance(value, (int, float)) or not device.get("online"):
                continue
            was = counters[key]
            counters[key] = value
            if was is not None and value > was:
                extra = ""
                if key == "controller_punch":
                    extra = f"  power={device.get('punchPower')}"
                print(f"[{now}] {label}  #{value}{extra}")

        # Lane changes, from whichever device is driving the body.
        axis = vision.get("bodyX") if vision.get("online") else controller.get("tilt")
        lane = lane_of(axis if isinstance(axis, (int, float)) else None)
        if lane != previous.get("lane"):
            source = "camera" if vision.get("online") else "tilt"
            print(f"[{now}] LANE    {lane:8} ({source} = {axis})")
            previous["lane"] = lane

        if vision.get("online"):
            direction = vision.get("direction")
            if direction != previous.get("direction"):
                print(f"[{now}] REACH   {direction or 'rest'}")
                previous["direction"] = direction

        # A packet-rate line now and then, which is what tells a slow link from
        # a dead one.
        if time.monotonic() - rate_at >= 5:
            elapsed = time.monotonic() - rate_at
            for name in ("controller", "vision"):
                packets = snapshot[name].get("packets", 0)
                rate = (packets - rate_base[name]) / elapsed
                rate_base[name] = packets
                if rate > 0:
                    print(f"[{now}] rate    {name} {rate:.0f} packets/s")
            rate_at = time.monotonic()

        previous["controller"] = dict(controller)
        previous["vision"] = dict(vision)
        time.sleep(0.05)


# --------------------------------------------------------------- feedback --

def feedback(kind: str) -> None:
    """Fire one command at the controller, to check the LED, buzzer, and OLED."""
    reply = post("/api/feedback", {"kind": kind, "score": 1234, "combo": 5,
                                   "hp": 70, "monsterHp": 210, "level": 2,
                                   "state": "PLAYING"})
    command = reply["cmd"]
    r, g, b = command["led"]
    colour = "".join(name for name, on in (("RED", r), ("GREEN", g), ("BLUE", b)) if on)
    print(f"Sent '{kind}'. The controller should now:")
    print(f"  LED    {colour or 'off'}   for {command['ms']} ms")
    print(f"  buzzer {command['buzz']} Hz")
    print(f"  OLED   '{command['text']}'  with SCORE 1234  x5  HP 70  MON 210")
    print()
    print("It is collected on the ESP32's next push, so within ~50 ms.")


def sequence() -> None:
    kinds = list(get("/api/health")["kinds"])
    print(f"Firing all {len(kinds)} commands, 1.5 s apart. Watch the controller.\n")
    for kind in kinds:
        post("/api/feedback", {"kind": kind, "score": 1234, "combo": 5,
                               "hp": 70, "monsterHp": 210, "level": 2})
        print(f"  {kind}")
        time.sleep(1.5)
    print("\nDone. Every LED colour and buzzer tone the game can produce has played.")


def main() -> None:
    parser = argparse.ArgumentParser(description="LinguaPlay hardware bring-up")
    parser.add_argument("--check", action="store_true", help="one-shot diagnosis")
    parser.add_argument("--feedback", metavar="KIND", help="fire one LED/buzzer command")
    parser.add_argument("--sequence", action="store_true", help="fire every command in turn")
    args = parser.parse_args()

    if not require_bridge():
        raise SystemExit(1)

    if args.feedback:
        feedback(args.feedback)
    elif args.sequence:
        sequence()
    elif args.check:
        check()
    else:
        try:
            watch()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
