from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

controller_data = {
    "action": "READY",
    "joy": "CENTER",
    "button": 0,
    "x": 0,
    "y": 0,
<<<<<<< HEAD
    "punchPower": 0,
    "accPower": 0,
    # Steering angle for the kart chase: -1 fully left, 0 level, +1 fully right.
    "tilt": 0
=======
    "steer": 0.0,
    "angle": 0.0,
    "punchPower": 0.0,
    "accPower": 0.0
>>>>>>> 88ad8a1a2e7c428182d4c163c5bc373aaf7b2323
}


@app.post("/api/controller")
def receive_controller():
    global controller_data

    data = request.get_json(silent=True)

    if data is None:
        return jsonify({
            "ok": False,
            "error": "Invalid JSON"
        }), 400

    controller_data.update(data)

    print(
        "Action:", controller_data["action"],
        "| Steer:", controller_data["steer"],
        "| Angle:", controller_data["angle"]
    )

    return jsonify({"ok": True})


@app.get("/api/controller")
def get_controller():
    return jsonify(controller_data)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
