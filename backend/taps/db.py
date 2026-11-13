"""SQLite storage shared by the web server and the `taps` CLI.

Model:
  beers  - your library of everything you've ever had on tap (beer, wine, cider...)
  kegs   - one row per keg you've tapped; holds how much has been poured from it
  taps   - each physical tap points at the keg currently on it (or nothing)
  pours  - individual pours recorded by the flow meters (for future stats)

Flow meters write *increments* (poured_ml = poured_ml + x) so the CLI and the
server can safely touch the same database at the same time.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

KEG_SIZES = {
    # key: (label, milliliters)
    "corny": ("Corny keg (5 gal)", 18927),
    "sixtel": ("Sixtel (1/6 bbl)", 19550),
    "quarter": ("Quarter barrel (1/4 bbl)", 29337),
    "half": ("Half barrel (1/2 bbl)", 58674),
    "mini": ("Mini keg (5 L)", 5000),
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS beers (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    maker       TEXT,
    style       TEXT,
    kind        TEXT NOT NULL DEFAULT 'beer',
    abv         REAL,
    ibu         REAL,
    srm         REAL,
    color       TEXT,
    description TEXT,
    logo        TEXT,
    bubbles     INTEGER,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kegs (
    id          INTEGER PRIMARY KEY,
    tap_id      INTEGER NOT NULL,
    beer_id     INTEGER NOT NULL REFERENCES beers(id),
    size_ml     REAL NOT NULL,
    poured_ml   REAL NOT NULL DEFAULT 0,
    tapped_at   TEXT NOT NULL,
    kicked_at   TEXT
);
CREATE TABLE IF NOT EXISTS taps (
    id          INTEGER PRIMARY KEY,
    keg_id      INTEGER REFERENCES kegs(id)
);
CREATE TABLE IF NOT EXISTS pours (
    id          INTEGER PRIMARY KEY,
    tap_id      INTEGER NOT NULL,
    keg_id      INTEGER,
    ml          REAL NOT NULL,
    started_at  TEXT NOT NULL,
    ended_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kegs_beer ON kegs(beer_id);
"""

BEER_FIELDS = ("name", "maker", "style", "kind", "abv", "ibu", "srm", "color", "description", "logo", "bubbles")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def conn(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    def init(self, tap_ids: list[int]) -> None:
        with self.conn() as c:
            c.execute("PRAGMA journal_mode = WAL")
            c.executescript(SCHEMA)
            # migrations for databases created by older versions
            cols = {r["name"] for r in c.execute("PRAGMA table_info(beers)")}
            if "logo" not in cols:
                c.execute("ALTER TABLE beers ADD COLUMN logo TEXT")
            if "bubbles" not in cols:  # NULL = decide from the kind (see colors.has_bubbles)
                c.execute("ALTER TABLE beers ADD COLUMN bubbles INTEGER")
            for tid in tap_ids:
                c.execute("INSERT OR IGNORE INTO taps (id) VALUES (?)", (tid,))

    # ---------- beers ----------
    def list_beers(self, include_archived: bool = False) -> list[dict]:
        sql = """
            SELECT b.*,
                   MAX(k.tapped_at) AS last_tapped_at,
                   COUNT(k.id)      AS times_tapped
            FROM beers b LEFT JOIN kegs k ON k.beer_id = b.id
            {where}
            GROUP BY b.id
            ORDER BY last_tapped_at IS NULL, last_tapped_at DESC, b.name COLLATE NOCASE
        """.format(where="" if include_archived else "WHERE b.archived = 0")
        with self.conn() as c:
            return [dict(r) for r in c.execute(sql)]

    def get_beer(self, beer_id: int) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM beers WHERE id = ?", (beer_id,)).fetchone()
            return dict(r) if r else None

    def find_beers(self, query: str) -> list[dict]:
        """Lookup by id, exact name, or partial name/maker match."""
        q = query.strip()
        if q.isdigit():
            b = self.get_beer(int(q))
            return [b] if b else []
        beers = self.list_beers(include_archived=True)
        exact = [b for b in beers if b["name"].lower() == q.lower()]
        if exact:
            return exact
        ql = q.lower()
        return [b for b in beers if ql in b["name"].lower() or ql in (b["maker"] or "").lower()]

    def add_beer(self, data: dict) -> int:
        fields = {k: data.get(k) for k in BEER_FIELDS}
        if not fields.get("name"):
            raise ValueError("name is required")
        fields["kind"] = fields.get("kind") or "beer"
        ts = now()
        with self.conn() as c:
            cur = c.execute(
                f"INSERT INTO beers ({', '.join(BEER_FIELDS)}, created_at, updated_at) "
                f"VALUES ({', '.join('?' * len(BEER_FIELDS))}, ?, ?)",
                (*fields.values(), ts, ts),
            )
            return cur.lastrowid

    def update_beer(self, beer_id: int, data: dict) -> None:
        fields = {k: v for k, v in data.items() if k in BEER_FIELDS or k == "archived"}
        if not fields:
            return
        sets = ", ".join(f"{k} = ?" for k in fields)
        with self.conn() as c:
            c.execute(f"UPDATE beers SET {sets}, updated_at = ? WHERE id = ?", (*fields.values(), now(), beer_id))

    def delete_beer(self, beer_id: int) -> str:
        """Hard-delete if it was never tapped, otherwise archive (keeps keg history intact)."""
        with self.conn() as c:
            used = c.execute("SELECT COUNT(*) FROM kegs WHERE beer_id = ?", (beer_id,)).fetchone()[0]
            if used:
                c.execute("UPDATE beers SET archived = 1, updated_at = ? WHERE id = ?", (now(), beer_id))
                return "archived"
            c.execute("DELETE FROM beers WHERE id = ?", (beer_id,))
            return "deleted"

    # ---------- taps & kegs ----------
    def tap_rows(self) -> list[dict]:
        sql = """
            SELECT t.id AS tap_id, k.id AS keg_id, k.size_ml, k.poured_ml, k.tapped_at,
                   b.id AS beer_id, b.name, b.maker, b.style, b.kind, b.abv, b.ibu, b.srm,
                   b.color, b.description, b.logo, b.bubbles
            FROM taps t
            LEFT JOIN kegs k ON k.id = t.keg_id
            LEFT JOIN beers b ON b.id = k.beer_id
            ORDER BY t.id
        """
        with self.conn() as c:
            return [dict(r) for r in c.execute(sql)]

    def assign(self, tap_id: int, beer_id: int, *, new_keg: bool = True, size_ml: float | None = None) -> int:
        """Put a beer on a tap. new_keg=False just relabels the keg that's already there."""
        with self.conn() as c:
            if not c.execute("SELECT 1 FROM beers WHERE id = ?", (beer_id,)).fetchone():
                raise ValueError(f"No beer with id {beer_id}")
            tap = c.execute("SELECT keg_id FROM taps WHERE id = ?", (tap_id,)).fetchone()
            if tap is None:
                raise ValueError(f"No tap {tap_id}")
            current = tap["keg_id"]
            if current and not new_keg:
                c.execute("UPDATE kegs SET beer_id = ? WHERE id = ?", (beer_id, current))
                if size_ml:
                    c.execute("UPDATE kegs SET size_ml = ? WHERE id = ?", (size_ml, current))
                c.execute("UPDATE beers SET archived = 0 WHERE id = ?", (beer_id,))
                return current
            ts = now()
            if current:
                c.execute("UPDATE kegs SET kicked_at = ? WHERE id = ?", (ts, current))
            cur = c.execute(
                "INSERT INTO kegs (tap_id, beer_id, size_ml, tapped_at) VALUES (?, ?, ?, ?)",
                (tap_id, beer_id, size_ml or KEG_SIZES["corny"][1], ts),
            )
            c.execute("UPDATE taps SET keg_id = ? WHERE id = ?", (cur.lastrowid, tap_id))
            c.execute("UPDATE beers SET archived = 0 WHERE id = ?", (beer_id,))
            return cur.lastrowid

    def kick(self, tap_id: int) -> None:
        """Mark the keg on this tap as empty and leave the tap dry."""
        with self.conn() as c:
            tap = c.execute("SELECT keg_id FROM taps WHERE id = ?", (tap_id,)).fetchone()
            if tap and tap["keg_id"]:
                c.execute("UPDATE kegs SET kicked_at = ? WHERE id = ?", (now(), tap["keg_id"]))
            c.execute("UPDATE taps SET keg_id = NULL WHERE id = ?", (tap_id,))

    def set_level(self, tap_id: int, remaining_ml: float) -> None:
        with self.conn() as c:
            c.execute(
                "UPDATE kegs SET poured_ml = MAX(0, size_ml - ?) WHERE id = (SELECT keg_id FROM taps WHERE id = ?)",
                (remaining_ml, tap_id),
            )

    # ---------- flow meter hooks ----------
    def add_poured(self, tap_id: int, ml: float) -> None:
        with self.conn() as c:
            c.execute(
                "UPDATE kegs SET poured_ml = poured_ml + ? WHERE id = (SELECT keg_id FROM taps WHERE id = ?)",
                (ml, tap_id),
            )

    def log_pour(self, tap_id: int, ml: float, started_at: str, ended_at: str) -> None:
        with self.conn() as c:
            c.execute(
                "INSERT INTO pours (tap_id, keg_id, ml, started_at, ended_at) "
                "VALUES (?, (SELECT keg_id FROM taps WHERE id = ?), ?, ?, ?)",
                (tap_id, tap_id, ml, started_at, ended_at),
            )
