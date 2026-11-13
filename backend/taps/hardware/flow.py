"""Flow meters: count pulses on a GPIO pin and turn them into milliliters poured.

Every pulse adds 1000 / pulses_per_liter ml. A background thread flushes the
accumulated volume to the database twice a second and tracks pour sessions so
the display can animate while beer is flowing.
"""
from __future__ import annotations

import logging
import random
import threading
import time
from datetime import datetime, timezone

log = logging.getLogger(__name__)

POUR_IDLE_SECONDS = 1.5   # no pulses for this long = pour finished
MIN_LOGGED_POUR_ML = 30   # ignore drips / line settling when logging pours


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")


class FlowMeter:
    def __init__(self, tap_id: int, pulses_per_liter: float):
        self.tap_id = tap_id
        self.pulses_per_liter = pulses_per_liter
        self._lock = threading.Lock()
        self._pending = 0          # pulses not yet written to the db
        self.total_pulses = 0      # since start (handy for calibration)
        self.last_pulse = 0.0
        self.pour_started: float | None = None
        self.pour_ml = 0.0

    def pulse(self, n: int = 1) -> None:
        with self._lock:
            self._pending += n
            self.total_pulses += n
            self.last_pulse = time.time()
            if self.pour_started is None:
                self.pour_started = self.last_pulse
                self.pour_ml = 0.0

    @property
    def pouring(self) -> bool:
        return self.pour_started is not None and time.time() - self.last_pulse < POUR_IDLE_SECONDS

    def take(self) -> float:
        """Return ml since last call and reset the counter."""
        with self._lock:
            n, self._pending = self._pending, 0
        ml = n * 1000.0 / self.pulses_per_liter
        self.pour_ml += ml
        return ml

    def finish_pour_if_idle(self) -> tuple[float, str, str] | None:
        with self._lock:
            if self.pour_started is None or time.time() - self.last_pulse < POUR_IDLE_SECONDS:
                return None
            result = (self.pour_ml, _iso(self.pour_started), _iso(self.last_pulse))
            self.pour_started, self.pour_ml = None, 0.0
            return result

    def start(self) -> None: ...
    def stop(self) -> None: ...


class GpioFlowMeter(FlowMeter):
    def __init__(self, tap_id: int, pin: int, pulses_per_liter: float):
        super().__init__(tap_id, pulses_per_liter)
        self.pin = pin
        self._dev = None

    def start(self) -> None:
        from gpiozero import DigitalInputDevice  # only on the Pi

        self._dev = DigitalInputDevice(self.pin, pull_up=True, bounce_time=None)
        self._dev.when_activated = lambda: self.pulse()
        log.info("flow meter tap %s on GPIO%s", self.tap_id, self.pin)

    def stop(self) -> None:
        if self._dev:
            self._dev.close()


class MockFlowMeter(FlowMeter):
    def simulate_pour(self, ml: float = 473, seconds: float = 6.0) -> None:
        """Pretend someone pulled the handle (a 16 oz pint by default)."""
        pulses = int(ml / 1000 * self.pulses_per_liter)
        steps = int(seconds * 20)

        def run():
            for _ in range(steps):
                self.pulse(max(1, pulses // steps))
                time.sleep(seconds / steps)

        threading.Thread(target=run, daemon=True).start()


class FlowService:
    """Owns all meters, flushes to the db, optionally fakes pours for demos."""

    def __init__(self, db, meters: dict[int, FlowMeter], demo_pours: bool = False):
        self.db = db
        self.meters = meters
        self.demo_pours = demo_pours
        self._stop = threading.Event()

    def start(self) -> None:
        for m in self.meters.values():
            m.start()
        threading.Thread(target=self._run, name="flow", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        for m in self.meters.values():
            m.stop()

    def _run(self) -> None:
        next_demo = time.time() + 8
        while not self._stop.wait(0.5):
            for m in self.meters.values():
                try:
                    ml = m.take()
                    if ml:
                        self.db.add_poured(m.tap_id, ml)
                    done = m.finish_pour_if_idle()
                    if done and done[0] >= MIN_LOGGED_POUR_ML:
                        self.db.log_pour(m.tap_id, *done)
                except Exception:
                    log.exception("flow flush failed for tap %s", m.tap_id)
            if self.demo_pours and time.time() > next_demo:
                mocks = [m for m in self.meters.values() if isinstance(m, MockFlowMeter)]
                if mocks:
                    random.choice(mocks).simulate_pour(random.choice([355, 473, 473, 591]), random.uniform(5, 8))
                next_demo = time.time() + random.uniform(25, 50)
