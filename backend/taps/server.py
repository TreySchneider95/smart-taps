"""Web server: serves the kiosk display + console and a small JSON API."""
from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import config as config_mod
from .colors import color_label, display_color, has_bubbles
from .db import KEG_SIZES, Database
from .hardware import Hardware

log = logging.getLogger("taps")
# In Docker, nginx (the frontend container) serves the UI and this is API-only.
# Running locally without Docker, the API serves ../frontend itself.
FRONTEND = Path(os.environ.get("TAPS_FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend"))


class AssignBody(BaseModel):
    beer_id: int
    new_keg: bool = True
    keg: str | None = None   # key from KEG_SIZES
    size_ml: float | None = None


class BoostBody(BaseModel):
    seconds: float | None = None   # omitted = the tap's saved charge time


class ChargeTimeBody(BaseModel):
    seconds: float


CHARGE_MIN_SECONDS = 1.0
CHARGE_CHOICES = [1, 2, 3, 5, 7, 10, 15, 20]   # offered in the console, up to the tap's co2_max_seconds


class PinBody(BaseModel):
    pin: str


class LevelBody(BaseModel):
    percent: float


class BubblesBody(BaseModel):
    on: bool


THEMES = ("olive", "plum", "charcoal")
# Scenes are drawn by frontend/static/js/scenery.js; add new ones here too.
SCENES = ("off", "auto", "spring", "summer", "fall", "winter", "gameday", "volleyball", "traitors", "golden")
SURPRISES = ("calm", "lively", "party")
FIZZ = ("few", "some", "lots")
DEFAULT_APPEARANCE = {"theme": "olive", "warmth": 0, "scene": "auto", "surprises": "lively", "fizz": "some"}


class AppearanceBody(BaseModel):
    theme: Literal["olive", "plum", "charcoal"]                       # background color
    warmth: int = Field(0, ge=-5, le=5)                               # -5 coolest .. +5 warmest
    scene: str = "auto"                                               # one of SCENES; auto = season by the date
    surprises: Literal["calm", "lively", "party"] = "lively"          # how often critters show up
    fizz: Literal["few", "some", "lots"] = "some"                     # how many bubbles rise in the kegs

    @field_validator("scene")
    @classmethod
    def known_scene(cls, v: str) -> str:
        if v not in SCENES:
            raise ValueError(f"unknown scene {v!r}")
        return v


def logo_url(name: str | None) -> str | None:
    return f"/api/logos/{name}" if name else None


def create_app(cfg: config_mod.Config | None = None) -> FastAPI:
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = cfg or config_mod.load()
    db = Database(cfg.db_path)
    db.init([t.id for t in cfg.taps])
    hw = Hardware(cfg, db)
    boot_id = uuid.uuid4().hex[:8]

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hw.start()
        log.info("smart-taps up (mock=%s) with %d taps", cfg.mock, len(cfg.taps))
        yield
        hw.stop()

    app = FastAPI(title="Smart Taps", lifespan=lifespan)

    def require_pin(x_admin_pin: str | None = Header(default=None)):
        if cfg.admin_pin and x_admin_pin != cfg.admin_pin:
            raise HTTPException(401, "PIN required")

    def keg_size(body: AssignBody) -> float:
        if body.size_ml:
            return body.size_ml
        key = body.keg or cfg.default_keg
        return KEG_SIZES.get(key, KEG_SIZES["corny"])[1]

    def temperature_state() -> dict | None:
        t = hw.temperature
        if not t:
            return None
        unit = cfg.temperature_unit
        value = None
        status = "unknown"
        if t.celsius is not None:
            value = t.celsius * 9 / 5 + 32 if unit == "F" else t.celsius
            stale = t.updated_at and time.time() - t.updated_at > max(60, t.poll_seconds * 6)
            if stale:
                status = "stale"
            elif value > cfg.temp_target_high:
                status = "warm"
            elif value < cfg.temp_target_low:
                status = "cold"
            else:
                status = "ok"
        elif t.error:
            status = "error"
        return {
            "value": None if value is None else round(value, 1),
            "unit": unit,
            "status": status,
            "target_low": cfg.temp_target_low,
            "target_high": cfg.temp_target_high,
            "error": t.error,
        }

    def appearance() -> dict:
        a = db.get_setting("appearance") or {}
        def pick(key, allowed):
            return a.get(key) if a.get(key) in allowed else DEFAULT_APPEARANCE[key]

        try:
            warmth = max(-5, min(5, int(a.get("warmth", 0))))
        except (TypeError, ValueError):
            warmth = 0
        return {"theme": pick("theme", THEMES), "warmth": warmth,
                "scene": pick("scene", SCENES), "surprises": pick("surprises", SURPRISES),
                "fizz": pick("fizz", FIZZ)}

    def charge_seconds(tc) -> float:
        """How long one charge opens the gas: set in the console, else config.toml; never past the cap."""
        saved = (db.get_setting("co2_charge_seconds") or {}).get(str(tc.id))
        secs = float(saved if saved is not None else tc.co2_charge_seconds)
        return max(CHARGE_MIN_SECONDS, min(secs, tc.co2_max_seconds))

    def charge_choices(tc) -> list[float]:
        opts = {c for c in CHARGE_CHOICES if c <= tc.co2_max_seconds} | {tc.co2_max_seconds, charge_seconds(tc)}
        return sorted(int(c) if float(c).is_integer() else c for c in opts)

    def tap_state() -> list[dict]:
        rows = {r["tap_id"]: r for r in db.tap_rows()}
        out = []
        for tc in cfg.taps:
            r = rows.get(tc.id, {})
            meter = hw.meters.get(tc.id)
            relay = hw.relays.get(tc.id)
            beer = keg = None
            if r.get("beer_id"):
                beer = {
                    "id": r["beer_id"], "name": r["name"], "maker": r["maker"], "style": r["style"],
                    "kind": r["kind"], "abv": r["abv"], "ibu": r["ibu"], "srm": r["srm"],
                    "description": r["description"],
                    "color_hex": display_color(r["kind"], r["srm"], r["color"]),
                    "color_label": color_label(r["kind"], r["srm"], r["color"]),
                    "logo_url": logo_url(r["logo"]),
                    "bubbles": has_bubbles(r["kind"], r["color"], r["bubbles"]),
                }
            if r.get("keg_id"):
                remaining = max(0.0, r["size_ml"] - r["poured_ml"])
                keg = {
                    "id": r["keg_id"], "size_ml": r["size_ml"], "poured_ml": round(r["poured_ml"], 1),
                    "remaining_ml": round(remaining, 1),
                    "remaining_pct": round(remaining / r["size_ml"], 4) if r["size_ml"] else None,
                    "tapped_at": r["tapped_at"],
                }
            out.append({
                "id": tc.id,
                "beer": beer,
                "keg": keg,
                "flow_enabled": meter is not None,
                "pouring": bool(meter and meter.pouring),
                "co2": None if not relay else {
                    "active": relay.active,
                    "charge_seconds": charge_seconds(tc),
                    "max_seconds": tc.co2_max_seconds,
                    "choices": charge_choices(tc),
                },
            })
        return out

    # ---------------- read API ----------------
    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/meta")
    def meta():
        return {
            "bar": {"name": cfg.bar_name, "tagline": cfg.bar_tagline},
            "volume_unit": cfg.volume_unit,
            "pin_required": bool(cfg.admin_pin),
            "pin_length": len(cfg.admin_pin),
            "kegs": [{"key": k, "label": v[0], "ml": v[1]} for k, v in KEG_SIZES.items()],
            "default_keg": cfg.default_keg,
            "ssh_target": cfg.ssh_target,
            "mock": cfg.mock,
            "appearance": appearance(),
        }

    @app.get("/api/state")
    def state():
        return {"boot_id": boot_id, "temperature": temperature_state(), "taps": tap_state(), "appearance": appearance()}

    @app.get("/api/flow")
    def flow():
        """Raw pulse counters since startup — used by `taps calibrate`."""
        return {str(k): m.total_pulses for k, m in hw.meters.items()}

    @app.get("/api/beers")
    def beers():
        out = []
        for b in db.list_beers():
            b["color_hex"] = display_color(b["kind"], b["srm"], b["color"])
            b["logo_url"] = logo_url(b["logo"])
            b["bubbles"] = has_bubbles(b["kind"], b["color"], b["bubbles"])
            out.append(b)
        return out

    @app.get("/api/logos/{name}")
    def logo(name: str):
        path = (config_mod.data_dir() / "logos" / name).resolve()
        if path.parent != (config_mod.data_dir() / "logos").resolve() or not path.is_file():
            raise HTTPException(404)
        return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})

    # ---------------- console API (PIN-protected if a PIN is set) ----------------
    @app.post("/api/unlock")
    def unlock(body: PinBody):
        if cfg.admin_pin and body.pin != cfg.admin_pin:
            raise HTTPException(401, "Wrong PIN")
        return {"ok": True}

    @app.post("/api/taps/{tap_id}/assign", dependencies=[Depends(require_pin)])
    def assign(tap_id: int, body: AssignBody):
        try:
            keg_id = db.assign(tap_id, body.beer_id, new_keg=body.new_keg, size_ml=keg_size(body))
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True, "keg_id": keg_id}

    @app.post("/api/taps/{tap_id}/kick", dependencies=[Depends(require_pin)])
    def kick(tap_id: int):
        db.kick(tap_id)
        return {"ok": True}

    @app.post("/api/taps/{tap_id}/level", dependencies=[Depends(require_pin)])
    def level(tap_id: int, body: LevelBody):
        rows = {r["tap_id"]: r for r in db.tap_rows()}
        r = rows.get(tap_id)
        if not r or not r["keg_id"]:
            raise HTTPException(400, "No keg on this tap")
        db.set_level(tap_id, r["size_ml"] * max(0.0, min(100.0, body.percent)) / 100)
        return {"ok": True}

    @app.post("/api/beers/{beer_id}/bubbles", dependencies=[Depends(require_pin)])
    def bubbles(beer_id: int, body: BubblesBody):
        if not db.get_beer(beer_id):
            raise HTTPException(404, "No such beer")
        db.update_beer(beer_id, {"bubbles": int(body.on)})
        return {"ok": True}

    @app.post("/api/settings/appearance", dependencies=[Depends(require_pin)])
    def set_appearance(body: AppearanceBody):
        db.set_setting("appearance", body.model_dump())
        return {"ok": True, "appearance": appearance()}

    # Not PIN-protected: the Charge CO2 button lives on the main screen for whoever is pouring wine.
    # Safety comes from the relay itself (fixed pulse, hard cap, cooldown).
    @app.post("/api/taps/{tap_id}/co2")
    def co2(tap_id: int, body: BoostBody):
        relay = hw.relays.get(tap_id)
        tc = cfg.tap(tap_id)
        if not relay or not tc:
            raise HTTPException(404, "No CO2 relay on this tap")
        try:
            secs = relay.boost(body.seconds if body.seconds is not None else charge_seconds(tc))
        except RuntimeError as e:
            raise HTTPException(409, str(e))
        return {"ok": True, "seconds": secs}

    @app.post("/api/taps/{tap_id}/co2/seconds", dependencies=[Depends(require_pin)])
    def set_charge_time(tap_id: int, body: ChargeTimeBody):
        tc = cfg.tap(tap_id)
        if not tc or tap_id not in hw.relays:
            raise HTTPException(404, "No CO2 relay on this tap")
        if not CHARGE_MIN_SECONDS <= body.seconds <= tc.co2_max_seconds:
            raise HTTPException(400, f"Charge time must be {CHARGE_MIN_SECONDS:g}–{tc.co2_max_seconds:g} seconds")
        saved = db.get_setting("co2_charge_seconds") or {}
        saved[str(tap_id)] = body.seconds
        db.set_setting("co2_charge_seconds", saved)
        return {"ok": True, "seconds": charge_seconds(tc)}

    @app.post("/api/dev/pour/{tap_id}")
    def dev_pour(tap_id: int, ml: float = 473):
        meter = hw.meters.get(tap_id)
        if not cfg.mock or not hasattr(meter, "simulate_pour"):
            raise HTTPException(404, "Only available in mock mode")
        meter.simulate_pour(ml)
        return {"ok": True}

    if (FRONTEND / "index.html").exists():
        @app.get("/", include_in_schema=False)
        def index():
            return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-cache"})

        app.mount("/static", StaticFiles(directory=FRONTEND / "static"), name="static")
    return app


def serve() -> None:
    """Local (non-Docker) run: API + UI on one port."""
    import uvicorn

    cfg = config_mod.load()
    uvicorn.run(create_app(cfg), host=cfg.host, port=cfg.port, log_level="warning")
