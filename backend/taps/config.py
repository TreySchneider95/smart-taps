"""Load config.toml (falling back to sensible defaults)."""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # backend/
EXAMPLE_CONFIG = ROOT / "config.example.toml"


def data_dir() -> Path:
    # /data inside Docker; ./data at the project root when running locally
    return Path(os.environ.get("TAPS_DATA_DIR", ROOT.parent / "data"))


@dataclass
class TapConfig:
    id: int
    flow_pin: int = 0
    pulses_per_liter: float = 5600.0
    co2_relay_pin: int = 0
    co2_relay_active_high: bool = False
    co2_boost_seconds: list[float] = field(default_factory=lambda: [2, 5])
    co2_max_seconds: float = 10.0

    @property
    def has_flow(self) -> bool:
        return self.flow_pin > 0

    @property
    def has_co2(self) -> bool:
        return self.co2_relay_pin > 0


@dataclass
class Config:
    bar_name: str = "On Tap"
    bar_tagline: str = "The Basement Bar"
    temperature_unit: str = "F"
    volume_unit: str = "gal"
    default_keg: str = "corny"
    admin_pin: str = ""
    host: str = "0.0.0.0"
    port: int = 8000
    mock: bool = False
    demo_pours: bool = False
    gpio_chip: int = 0
    ssh_target: str = ""
    temp_enabled: bool = False
    temp_sensor_id: str = ""
    temp_poll_seconds: float = 10.0
    temp_target_low: float = 34.0
    temp_target_high: float = 40.0
    taps: list[TapConfig] = field(default_factory=lambda: [TapConfig(id=i) for i in range(1, 5)])
    db_path: Path = field(default_factory=lambda: data_dir() / "taps.db")

    def tap(self, tap_id: int) -> TapConfig | None:
        return next((t for t in self.taps if t.id == tap_id), None)


def config_path() -> Path:
    return Path(os.environ.get("TAPS_CONFIG", data_dir() / "config.toml"))


def load() -> Config:
    path = config_path()
    raw: dict = {}
    if path.exists():
        with open(path, "rb") as f:
            raw = tomllib.load(f)

    bar = raw.get("bar", {})
    display = raw.get("display", {})
    server = raw.get("server", {})
    hw = raw.get("hardware", {})
    temp = raw.get("temperature", {})

    cfg = Config(
        bar_name=bar.get("name", Config.bar_name),
        bar_tagline=bar.get("tagline", Config.bar_tagline),
        temperature_unit=str(display.get("temperature_unit", "F")).upper()[:1],
        volume_unit=display.get("volume_unit", "gal"),
        default_keg=display.get("default_keg", "corny"),
        admin_pin=str(display.get("admin_pin", "") or ""),
        host=server.get("host", "0.0.0.0"),
        port=int(server.get("port", 8000)),
        mock=bool(hw.get("mock", False)) or os.environ.get("TAPS_MOCK") == "1",
        demo_pours=bool(hw.get("demo_pours", False)) or os.environ.get("TAPS_DEMO_POURS") == "1",
        gpio_chip=int(hw.get("gpio_chip", 0)),
        ssh_target=os.environ.get("TAPS_SSH_TARGET", ""),
        temp_enabled=bool(temp.get("enabled", False)),
        temp_sensor_id=temp.get("sensor_id", ""),
        temp_poll_seconds=float(temp.get("poll_seconds", 10)),
        temp_target_low=float(temp.get("target_low", 34.0)),
        temp_target_high=float(temp.get("target_high", 40.0)),
    )
    if "taps" in raw:
        known = set(TapConfig.__dataclass_fields__)
        cfg.taps = [TapConfig(**{k: v for k, v in t.items() if k in known}) for t in raw["taps"]]
    if os.environ.get("TAPS_DB"):
        cfg.db_path = Path(os.environ["TAPS_DB"])
    return cfg
