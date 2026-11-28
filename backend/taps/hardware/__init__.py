"""Everything that touches GPIO lives here. The rest of the app only sees `Hardware`."""
from __future__ import annotations

import logging
from pathlib import Path

from ..config import Config
from ..db import Database
from .flow import FlowMeter, FlowService, GpioFlowMeter, MockFlowMeter
from .relay import Co2Relay, GpioCo2Relay, MockCo2Relay
from .temperature import DS18B20, MockTemperature, TemperatureMonitor

log = logging.getLogger(__name__)


class Hardware:
    def __init__(self, cfg: Config, db: Database):
        self.cfg = cfg
        self.temperature: TemperatureMonitor | None = None
        self.meters: dict[int, FlowMeter] = {}
        self.relays: dict[int, Co2Relay] = {}

        if cfg.temp_enabled or cfg.mock:
            self.temperature = (
                MockTemperature(cfg.temp_poll_seconds) if cfg.mock
                else DS18B20(cfg.temp_sensor_id, cfg.temp_poll_seconds)
            )

        # The same config.toml is used on the Mac and the Pi. Where there's no GPIO chip (a Mac,
        # or a Pi without docker-compose.override.yml), simulate the pins that are configured.
        simulate_gpio = False
        if not cfg.mock and any(t.has_flow or t.has_co2 for t in cfg.taps):
            chip = Path(f"/dev/gpiochip{cfg.gpio_chip}")
            if chip.exists():
                from gpiozero import Device
                from gpiozero.pins.lgpio import LGPIOFactory

                Device.pin_factory = LGPIOFactory(chip=cfg.gpio_chip)
            else:
                simulate_gpio = True
                log.warning(
                    "%s not found: flow meters and CO2 relay are SIMULATED. On the Pi, run "
                    "`cp docker-compose.pi-hardware.yml docker-compose.override.yml && docker compose up -d`.",
                    chip,
                )

        for t in cfg.taps:
            if simulate_gpio:
                if t.has_flow:
                    self.meters[t.id] = MockFlowMeter(t.id, t.pulses_per_liter)
                if t.has_co2:
                    self.relays[t.id] = MockCo2Relay(t.id, t.co2_max_seconds)
                continue
            if cfg.mock:
                # In mock mode every tap gets a pretend meter; relay only where configured
                # (or on the first tap, so you can try the button).
                self.meters[t.id] = MockFlowMeter(t.id, t.pulses_per_liter)
                if t.has_co2 or t.id == cfg.taps[0].id:
                    self.relays[t.id] = MockCo2Relay(t.id, t.co2_max_seconds)
                continue
            if t.has_flow:
                self.meters[t.id] = GpioFlowMeter(t.id, t.flow_pin, t.pulses_per_liter)
            if t.has_co2:
                self.relays[t.id] = GpioCo2Relay(t.id, t.co2_relay_pin, t.co2_relay_active_high, t.co2_max_seconds)

        self.flow = FlowService(db, self.meters, demo_pours=cfg.mock and cfg.demo_pours)

    def start(self) -> None:
        if self.temperature:
            self.temperature.start()
        for r in self.relays.values():
            r.start()
        self.flow.start()

    def stop(self) -> None:
        for r in self.relays.values():
            try:
                r.stop()
            except Exception:
                log.exception("relay stop failed")
        self.flow.stop()
        if self.temperature:
            self.temperature.stop()
