"""CO2 boost relay (e.g. a solenoid valve on the wine keg's gas line).

Safety rules baked in:
  * every boost is a timed pulse, never "on until someone remembers to turn it off"
  * a hard per-boost cap (co2_max_seconds) regardless of what the UI asks for
  * a short cooldown between boosts
  * the relay is forced off on startup and shutdown
"""
from __future__ import annotations

import logging
import threading
import time

log = logging.getLogger(__name__)
COOLDOWN_SECONDS = 3.0


class Co2Relay:
    def __init__(self, tap_id: int, max_seconds: float = 10.0):
        self.tap_id = tap_id
        self.max_seconds = max_seconds
        self.active_until = 0.0
        self.last_off = 0.0
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()

    # hardware hooks
    def _on(self) -> None: ...
    def _off(self) -> None: ...
    def start(self) -> None:
        self._off()

    def stop(self) -> None:
        self.off()

    @property
    def active(self) -> bool:
        return time.time() < self.active_until

    def boost(self, seconds: float) -> float:
        seconds = max(0.2, min(float(seconds), self.max_seconds))
        with self._lock:
            if self.active:
                raise RuntimeError("Already boosting")
            if time.time() - self.last_off < COOLDOWN_SECONDS:
                raise RuntimeError("Give it a few seconds between boosts")
            self._on()
            self.active_until = time.time() + seconds
            self._timer = threading.Timer(seconds, self.off)
            self._timer.daemon = True
            self._timer.start()
        log.info("CO2 boost tap %s for %.1fs", self.tap_id, seconds)
        return seconds

    def off(self) -> None:
        with self._lock:
            if self._timer:
                self._timer.cancel()
                self._timer = None
            self._off()
            if self.active_until:
                self.last_off = time.time()
            self.active_until = 0.0


class GpioCo2Relay(Co2Relay):
    def __init__(self, tap_id: int, pin: int, active_high: bool, max_seconds: float):
        super().__init__(tap_id, max_seconds)
        from gpiozero import OutputDevice  # only on the Pi

        self._dev = OutputDevice(pin, active_high=active_high, initial_value=False)
        log.info("CO2 relay tap %s on GPIO%s", tap_id, pin)

    def _on(self) -> None:
        self._dev.on()

    def _off(self) -> None:
        self._dev.off()

    def stop(self) -> None:
        super().stop()
        self._dev.close()


class MockCo2Relay(Co2Relay):
    def _on(self) -> None:
        log.info("[mock] CO2 relay tap %s ON", self.tap_id)

    def _off(self) -> None:
        log.info("[mock] CO2 relay tap %s OFF", self.tap_id)
