"""
Non-blocking sender for the computer-vision script.

The pose loop must never wait on a socket. A frame spent inside `requests.post`
is a frame not tracking the player, and on a bad connection the timeout alone
would drop the tracker to single-digit FPS - which the game would read as the
player standing still.

So the loop only ever writes the newest state into a slot, and a background
thread posts whatever is in that slot at a fixed rate. Dropping intermediate
states is safe because every field is absolute rather than incremental: the
newest packet fully describes where the player is. Punches are the exception,
and they survive because they travel as a monotonic count - the game reads an
increment, not an edge, so a coalesced packet still reports that one happened.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from typing import Any, Dict, Optional


class BridgeClient:
    """Posts the latest state to the bridge from a background thread."""

    def __init__(self, url: str, rate_hz: float = 50.0, timeout: float = 0.5):
        self.url = url
        self.interval = 1.0 / max(rate_hz, 1.0)
        self.timeout = timeout

        self._latest: Optional[Dict[str, Any]] = None
        self._lock = threading.Lock()
        # Woken by every send() so a fresh state goes out immediately rather
        # than waiting out the tick it just missed.
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

        self.connected = False
        self.sent = 0
        self.failures = 0
        self.last_error: Optional[str] = None

    def start(self) -> "BridgeClient":
        if self._thread is not None:
            return self
        self._thread = threading.Thread(target=self._run, name="bridge-client", daemon=True)
        self._thread.start()
        return self

    def send(self, payload: Dict[str, Any]) -> None:
        with self._lock:
            self._latest = payload
        self._wake.set()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
            self._thread = None

    def _run(self) -> None:
        while not self._stop.is_set():
            # Wait for either a fresh state or the next tick, whichever is
            # sooner, so an idle tracker is not posting the same frame forever.
            self._wake.wait(self.interval)
            self._wake.clear()
            if self._stop.is_set():
                break

            with self._lock:
                payload = self._latest
                self._latest = None

            if payload is None:
                continue

            self._post(payload)

    def _post(self, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout):
                pass
            self.sent += 1
            if not self.connected:
                self.connected = True
                self.last_error = None
                print(f"Bridge connected: {self.url}")
        except (urllib.error.URLError, OSError) as exc:
            self.failures += 1
            reason = str(getattr(exc, "reason", exc))
            if self.connected or self.last_error != reason:
                # One line per distinct problem, not one per dropped frame.
                print(f"Bridge unavailable ({reason}) - the game keeps running without vision.")
            self.connected = False
            self.last_error = reason
