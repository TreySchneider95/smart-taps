"""Web server: serves the kiosk display + console and a small JSON API."""
from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config as config_mod
from .colors import color_label, display_color
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
    seconds: float


class PinBody(BaseModel):
    pin: str


class LevelBody(BaseModel):
    percent: float


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
                    "boost_seconds": tc.co2_boost_seconds,
                    "max_seconds": tc.co2_max_seconds,
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
        }

    @app.get("/api/state")
    def state():
        return {"boot_id": boot_id, "temperature": temperature_state(), "taps": tap_state()}

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

    # Not PIN-protected: the Charge CO2 button lives on the main screen for whoever is pouring wine.
    # Safety comes from the relay itself (fixed pulse, hard cap, cooldown).
    @app.post("/api/taps/{tap_id}/co2")
    def co2(tap_id: int, body: BoostBody):
        relay = hw.relays.get(tap_id)
        if not relay:
            raise HTTPException(404, "No CO2 relay on this tap")
        try:
            secs = relay.boost(body.seconds)
        except RuntimeError as e:
            raise HTTPException(409, str(e))
        return {"ok": True, "seconds": secs}

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
