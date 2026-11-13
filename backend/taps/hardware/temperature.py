"""Kegerator temperature from a DS18B20 1-wire probe (read straight from sysfs, no libraries)."""
from __future__ import annotations

import logging
import math
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)
W1_ROOT = Path("/sys/bus/w1/devices")


class TemperatureMonitor:
    """Polls a sensor in a background thread; `.celsius` is the latest reading (or None)."""

    def __init__(self, poll_seconds: float = 10.0):
        self.poll_seconds = poll_seconds
        self.celsius: float | None = None
        self.updated_at: float | None = None
        self.error: str | None = None
        self.history: list[tuple[float, float]] = []  # (unix time, celsius), ~last 24h
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def read_celsius(self) -> float:
        raise NotImplementedError

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="temperature", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                c = self.read_celsius()
                self.celsius, self.updated_at, self.error = c, time.time(), None
                self.history.append((self.updated_at, c))
                cutoff = self.updated_at - 86400
                while self.history and self.history[0][0] < cutoff:
                    self.history.pop(0)
            except Exception as e:  # sensor unplugged, CRC error, etc.
                self.error = str(e)
                log.warning("temperature read failed: %s", e)
            self._stop.wait(self.poll_seconds)


class DS18B20(TemperatureMonitor):
    def __init__(self, sensor_id: str = "", poll_seconds: float = 10.0):
        super().__init__(poll_seconds)
        self.sensor_id = sensor_id

    def _device(self) -> Path:
        if self.sensor_id:
            return W1_ROOT / self.sensor_id
        found = sorted(W1_ROOT.glob("28-*"))
        if not found:
            raise RuntimeError("no DS18B20 found (is dtoverlay=w1-gpio enabled?)")
        return found[0]

    def read_celsius(self) -> float:
        dev = self._device()
        lines = (dev / "w1_slave").read_text().strip().splitlines()
        if not lines or not lines[0].endswith("YES"):
            raise RuntimeError("CRC check failed")
        _, _, raw = lines[1].partition("t=")
        c = int(raw) / 1000.0
        if c == 85.0:  # power-on reset value; not a real reading
            raise RuntimeError("sensor returned power-on value")
        return c


class MockTemperature(TemperatureMonitor):
    """Gentle drift around 3 °C (~37 °F) so the UI has something to show."""

    def read_celsius(self) -> float:
        t = time.time()
        return 2.9 + 0.5 * math.sin(t / 300) + 0.1 * math.sin(t / 17)
