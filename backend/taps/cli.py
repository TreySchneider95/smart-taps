"""`taps` command line tool. Run on the Pi (or from your Mac via ssh).

  taps                      what's on tap right now
  taps add                  add a new beer/wine (asks you questions)
  taps beers                your library
  taps tap 2 "Pliny"        put a beer on tap 2 (fresh keg)
  taps logo pliny <url>     give it a logo for the medallion
  taps kick 2               tap 2 is empty
  taps --help               everything else
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime

from . import config as config_mod
from .colors import KINDS, display_color, parse_color_input
from .db import BEER_FIELDS, KEG_SIZES, Database

TTY = sys.stdout.isatty()


# ---------------- pretty output helpers ----------------
def _c(code: str, s: str) -> str:
    return f"\033[{code}m{s}\033[0m" if TTY else s


def bold(s): return _c("1", s)
def dim(s): return _c("2", s)
def brass(s): return _c("38;2;201;162;74", s)


def swatch(hex_color: str) -> str:
    if not TTY:
        return ""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return f"\033[38;2;{r};{g};{b}m██\033[0m "


def beer_line(b: dict) -> str:
    bits = [b.get("style"), f"{b['abv']:g}%" if b.get("abv") else None, b.get("maker")]
    meta = dim(" · ".join(x for x in bits if x))
    return f"{swatch(display_color(b['kind'], b['srm'], b['color']))}{bold(b['name'])}  {meta}"


def local_date(iso: str | None) -> str:
    if not iso:
        return ""
    return datetime.fromisoformat(iso).astimezone().strftime("%b %-d")


def die(msg: str) -> None:
    print(_c("31", msg), file=sys.stderr)
    sys.exit(1)


# ---------------- prompting ----------------
def ask(label: str, default=None, cast=str, required=False):
    shown = f" [{default}]" if default not in (None, "") else ""
    while True:
        try:
            raw = input(f"  {label}{dim(shown)}: ").strip()
        except EOFError:
            print()
            sys.exit(1)
        if not raw:
            if default not in (None, ""):
                return default
            if required:
                print(_c("33", "    (required)"))
                continue
            return None
        if raw == "-":  # clear a field while editing
            return None
        try:
            return cast(raw)
        except ValueError as e:
            print(_c("33", f"    {e or 'try again'}"))


def number(raw: str) -> float:
    return float(raw.rstrip("%"))


def prompt_beer(existing: dict | None = None) -> dict:
    e = existing or {}
    print(dim("  (Enter keeps the value in [brackets]; '-' clears it)\n") if existing else "")
    data = {}
    data["name"] = ask("Name", e.get("name"), required=True)
    kind = ask(f"Kind ({'/'.join(KINDS[:4])}/...)", e.get("kind") or "beer")
    data["kind"] = kind.lower()
    is_beer = data["kind"] == "beer"
    data["maker"] = ask("Brewery" if is_beer else "Maker / winery", e.get("maker"))
    data["style"] = ask("Style (e.g. Hazy IPA)" if is_beer else "Style / varietal", e.get("style"))
    data["abv"] = ask("ABV %", e.get("abv"), number)
    if is_beer:
        data["ibu"] = ask("IBU", e.get("ibu"), number)
    else:
        data["ibu"] = e.get("ibu")
    current_color = e.get("color") or (f"{e['srm']:g}" if e.get("srm") else None)
    hint = "SRM 1-40 or straw/gold/amber/brown/black" if is_beer else "red/white/rose/orange or #hex"
    while True:
        raw = ask(f"Color ({hint})", current_color)
        try:
            data["srm"], data["color"] = parse_color_input(str(raw or ""), data["kind"])
            break
        except ValueError as err:
            print(_c("33", f"    {err}"))
    data["description"] = ask("Tasting notes (one or two lines)", e.get("description"))
    return data


# ---------------- commands ----------------
def cmd_status(db: Database, cfg, args):
    print(brass(f"\n  {cfg.bar_name} · {cfg.bar_tagline}\n"))
    for r in db.tap_rows():
        tag = bold(f"  Tap {r['tap_id']}  ")
        if not r["beer_id"]:
            print(tag + dim("— empty —"))
            continue
        left = ""
        if r["size_ml"]:
            pct = max(0, 1 - r["poured_ml"] / r["size_ml"])
            left = dim(f"   [{pct:.0%} left, tapped {local_date(r['tapped_at'])}]")
        print(tag + beer_line(r) + left)
    print()


def cmd_beers(db: Database, cfg, args):
    beers = db.list_beers(include_archived=args.all)
    if not beers:
        print("No beers yet. Add one with:  taps add")
        return
    for b in beers:
        last = dim(f"  last on tap {local_date(b['last_tapped_at'])}") if b["last_tapped_at"] else dim("  never tapped")
        arch = _c("33", " (archived)") if b["archived"] else ""
        num = dim(f"#{b['id']:<3}")
        print(f"  {num} {beer_line(b)}{arch}{last}")


def cmd_add(db: Database, cfg, args):
    if args.name:
        srm, color = parse_color_input(args.color or "", args.kind)
        data = {
            "name": args.name, "maker": args.maker, "style": args.style, "kind": args.kind,
            "abv": args.abv, "ibu": args.ibu, "srm": srm, "color": color, "description": args.notes,
        }
    else:
        print(brass("\n  New beer\n"))
        data = prompt_beer()
    beer_id = db.add_beer(data)
    print(f"\n  Added #{beer_id}: {beer_line(db.get_beer(beer_id))}")
    tap = args.tap
    if tap is None and not args.name and sys.stdin.isatty():
        tap = ask("Put it on a tap now? (tap number, or Enter to skip)", None, int)
    if tap:
        _assign(db, cfg, tap, beer_id, args.keg, new_keg=True)


def resolve_beer(db: Database, query: str) -> dict:
    matches = db.find_beers(query)
    if not matches:
        die(f"No beer matches {query!r}. See `taps beers`.")
    if len(matches) == 1:
        return matches[0]
    print(f"  {query!r} matches several:")
    for i, b in enumerate(matches, 1):
        print(f"   {i}) {beer_line(b)}")
    if not sys.stdin.isatty():
        die("Be more specific (or use the #id).")
    i = ask("Which one", None, int, required=True)
    if not 1 <= i <= len(matches):
        die("Nope.")
    return matches[i - 1]


def cmd_edit(db: Database, cfg, args):
    beer = resolve_beer(db, args.beer)
    print(brass(f"\n  Editing #{beer['id']}\n"))
    db.update_beer(beer["id"], prompt_beer(beer))
    print(f"\n  Saved: {beer_line(db.get_beer(beer['id']))}")


def cmd_rm(db: Database, cfg, args):
    beer = resolve_beer(db, args.beer)
    on_tap = [r["tap_id"] for r in db.tap_rows() if r["beer_id"] == beer["id"]]
    if on_tap:
        die(f"{beer['name']} is on tap {on_tap[0]} right now — kick it first.")
    print(f"  {db.delete_beer(beer['id']).capitalize()} {beer['name']}.")


def _assign(db, cfg, tap: int, beer_id: int, keg: str | None, new_keg: bool):
    if not cfg.tap(tap):
        die(f"No tap {tap}. Taps are: {', '.join(str(t.id) for t in cfg.taps)}")
    key = keg or cfg.default_keg
    if key not in KEG_SIZES:
        die(f"Unknown keg size {key!r}. One of: {', '.join(KEG_SIZES)}")
    db.assign(tap, beer_id, new_keg=new_keg, size_ml=KEG_SIZES[key][1] if new_keg or keg else None)
    what = f"fresh {KEG_SIZES[key][0]}" if new_keg else "relabelled"
    print(f"  Tap {tap}: {beer_line(db.get_beer(beer_id))}  {dim(f'({what})')}")


def cmd_tap(db: Database, cfg, args):
    beer = resolve_beer(db, args.beer)
    _assign(db, cfg, args.tap, beer["id"], args.keg, new_keg=not args.same_keg)


def cmd_kick(db: Database, cfg, args):
    db.kick(args.tap)
    print(f"  Tap {args.tap} is now empty. RIP.")


def cmd_level(db: Database, cfg, args):
    rows = {r["tap_id"]: r for r in db.tap_rows()}
    r = rows.get(args.tap)
    if not r or not r["keg_id"]:
        die(f"Tap {args.tap} has no keg.")
    db.set_level(args.tap, r["size_ml"] * max(0, min(100, args.percent)) / 100)
    print(f"  Tap {args.tap} set to {args.percent:g}% full.")


def cmd_kegs(db, cfg, args):
    for k, (label, ml) in KEG_SIZES.items():
        star = brass(" (default)") if k == cfg.default_keg else ""
        print(f"  {k:<8} {label:<26} {ml / 1000:.1f} L  ≈ {ml / 473.176:.0f} pints{star}")


def cmd_export(db: Database, cfg, args):
    beers = [{k: b[k] for k in BEER_FIELDS if b[k] is not None} for b in db.list_beers(include_archived=True)]
    json.dump(beers, sys.stdout, indent=2)
    print()


def cmd_import(db: Database, cfg, args):
    with (sys.stdin if args.file == "-" else open(args.file)) as f:
        items = json.load(f)
    existing = {b["name"].lower(): b for b in db.list_beers(include_archived=True)}
    added = updated = 0
    for item in items:
        if "color" in item and isinstance(item["color"], (int, float)):
            item["srm"], item["color"] = float(item["color"]), None
        found = existing.get(item.get("name", "").lower())
        if found:
            db.update_beer(found["id"], item)
            updated += 1
        else:
            db.add_beer(item)
            added += 1
    print(f"  Imported: {added} new, {updated} updated.")


DEMO = [
    {"name": "Estate Pinot Noir", "maker": "Willow Creek Cellars", "style": "Pinot Noir", "kind": "wine", "abv": 13.5,
     "color": "red", "description": "Bright cherry, a little earth, soft tannins. Served by the glass."},
    {"name": "Lumberjack Hazy", "maker": "Pine Hollow Brewing", "style": "Hazy IPA", "abv": 6.8, "ibu": 45, "srm": 5,
     "description": "Pillowy oats, a wall of mango and tangerine, barely-there bitterness."},
    {"name": "Copper Kettle", "maker": "Old Mill Brewery", "style": "Irish Red Ale", "abv": 5.2, "ibu": 22, "srm": 16,
     "description": "Toffee, toasted bread crust and a dry, clean finish."},
    {"name": "Midnight Oil", "maker": "Basement Batch #12", "style": "Oatmeal Stout", "abv": 6.1, "ibu": 35, "srm": 40,
     "description": "Silky roast coffee and dark chocolate. Homebrewed right here."},
    {"name": "Bavarian Morning", "maker": "Pine Hollow Brewing", "style": "Hefeweizen", "abv": 5.0, "ibu": 12, "srm": 4,
     "description": "Banana bread and clove, cloudy and crushable."},
]


def cmd_demo(db: Database, cfg, args):
    ids = [db.add_beer(b) for b in DEMO]
    for tap, beer_id in zip([t.id for t in cfg.taps], ids):
        db.assign(tap, beer_id, size_ml=KEG_SIZES[cfg.default_keg][1])
    import random
    for t in cfg.taps:
        db.set_level(t.id, KEG_SIZES[cfg.default_keg][1] * random.uniform(0.2, 0.95))
    print("  Loaded demo beers onto the taps. (Remove with `taps rm <name>` after kicking.)")


def cmd_calibrate(db: Database, cfg, args):
    """Pour a known volume and compute pulses_per_liter from the running server's counters."""
    import urllib.request

    tc = cfg.tap(args.tap)
    if not tc or not (tc.has_flow or cfg.mock):
        die(f"Tap {args.tap} has no flow meter configured (set flow_pin in config.toml).")
    url = f"http://127.0.0.1:{cfg.port}/api/flow"

    def pulses() -> int:
        with urllib.request.urlopen(url, timeout=3) as r:
            return json.load(r).get(str(args.tap), 0)

    try:
        before = pulses()
    except OSError:
        die("Couldn't reach the server. Is it running?  docker compose ps")
    ml = args.ml
    input(f"  Pour exactly {ml:g} ml ({ml / 29.5735:.1f} oz) from tap {args.tap} into a measuring jug, then press Enter… ")
    n = pulses() - before
    if n <= 0:
        die("No pulses seen. Check the wiring / flow_pin.")
    ppl = n / (ml / 1000)
    print(f"\n  {n} pulses for {ml:g} ml  →  pulses_per_liter = {ppl:.0f}")
    print(f"  Current setting: {tc.pulses_per_liter:g}. Put the new value in data/config.toml under tap {args.tap},")
    print("  then: docker compose restart backend   (repeat 2-3 times and average for best accuracy)")


LOGO_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif"}
LOGO_EXTS = {"png", "jpg", "jpeg", "webp", "svg", "gif"}
MAX_LOGO_BYTES = 5 * 1024 * 1024


def cmd_logo(db: Database, cfg, args):
    """Attach a logo image (file or URL) to a beer; it shows in the brass medallion."""
    import secrets
    import urllib.request
    from pathlib import Path

    beer = resolve_beer(db, args.beer)
    logos = config_mod.data_dir() / "logos"
    old = beer.get("logo")

    def remove_old():
        if old and (logos / old).is_file():
            (logos / old).unlink()

    if args.clear:
        db.update_beer(beer["id"], {"logo": None})
        remove_old()
        print(f"  Removed the logo from {beer['name']}.")
        return
    if not args.source:
        die("Give an image file or URL, e.g.  taps logo pliny https://example.com/pliny.png")

    src = args.source
    if src.startswith(("http://", "https://")):
        req = urllib.request.Request(src, headers={"User-Agent": "smart-taps"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                ctype = r.headers.get_content_type()
                data = r.read(MAX_LOGO_BYTES + 1)
        except OSError as e:
            die(f"Couldn't download that: {e}")
        ext = LOGO_TYPES.get(ctype) or Path(src.split("?")[0]).suffix.lstrip(".").lower()
    else:
        # The data/ folder on the Pi is /data in the container, so accept either spelling.
        rel = src[5:] if src.startswith("data/") else src
        candidates = [Path(src), config_mod.data_dir() / rel]
        path = next((c for c in candidates if c.is_file()), None)
        if not path:
            die(f"No file at {src}. Copy it into the project's data/ folder first, e.g.\n"
                f"  scp pliny.png pi@kegerator.local:smart-taps/data/   then   ./taps logo pliny data/pliny.png")
        ext = path.suffix.lstrip(".").lower()
        data = path.read_bytes()
    if ext not in LOGO_EXTS:
        die("Logo must be a PNG, JPG, WebP, SVG or GIF.")
    if len(data) > MAX_LOGO_BYTES:
        die("That image is over 5 MB; use something smaller.")

    logos.mkdir(parents=True, exist_ok=True)
    name = f"beer-{beer['id']}-{secrets.token_hex(3)}.{'jpg' if ext == 'jpeg' else ext}"
    (logos / name).write_bytes(data)
    db.update_beer(beer["id"], {"logo": name})
    remove_old()
    print(f"  Logo set for {beer['name']}.")


def cmd_init(db, cfg, args):
    """Container start-up: create data/config.toml from the example if missing (db is created by main)."""
    import shutil

    path = config_mod.config_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(config_mod.EXAMPLE_CONFIG, path)
        print(f"Created {path} — edit it to name your bar, set a PIN and wire up sensors.")


def cmd_serve(db, cfg, args):
    from .server import serve
    serve()


def main(argv=None):
    p = argparse.ArgumentParser(prog="taps", description="Manage your kegerator taps.",
                                formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = p.add_subparsers(dest="cmd")

    sub.add_parser("status", help="what's on tap (default)")
    s = sub.add_parser("beers", aliases=["ls", "list"], help="list your beer library")
    s.add_argument("--all", action="store_true", help="include archived")

    s = sub.add_parser("add", help="add a beer/wine (interactive unless --name is given)")
    s.add_argument("--name"); s.add_argument("--maker"); s.add_argument("--style")
    s.add_argument("--kind", default="beer", choices=KINDS)
    s.add_argument("--abv", type=float); s.add_argument("--ibu", type=float)
    s.add_argument("--color", help="SRM number, word (amber, black, red...) or #hex")
    s.add_argument("--notes")
    s.add_argument("--tap", type=int, help="also put it on this tap")
    s.add_argument("--keg", choices=list(KEG_SIZES))

    s = sub.add_parser("edit", help="edit a beer"); s.add_argument("beer", help="#id or name")
    s = sub.add_parser("rm", help="delete (or archive) a beer"); s.add_argument("beer")
    s = sub.add_parser("logo", help="set a beer's logo from an image file or URL")
    s.add_argument("beer", help="#id or name"); s.add_argument("source", nargs="?", help="image path or URL")
    s.add_argument("--clear", action="store_true", help="remove the logo")

    s = sub.add_parser("tap", help="put a beer on a tap")
    s.add_argument("tap", type=int); s.add_argument("beer", help="#id or name")
    s.add_argument("--keg", choices=list(KEG_SIZES), help="keg size (default from config)")
    s.add_argument("--same-keg", action="store_true", help="just fix the label; keep current level")

    s = sub.add_parser("kick", help="mark a tap empty"); s.add_argument("tap", type=int)
    s = sub.add_parser("level", help="manually set how full a keg is")
    s.add_argument("tap", type=int); s.add_argument("percent", type=float)
    sub.add_parser("kegs", help="list keg sizes")
    sub.add_parser("export", help="dump beer library as JSON")
    s = sub.add_parser("import", help="add/update beers from a JSON file ('-' for stdin)")
    s.add_argument("file")
    s = sub.add_parser("calibrate", help="calibrate a tap's flow meter by pouring a known volume")
    s.add_argument("tap", type=int); s.add_argument("--ml", type=float, default=500, help="volume you'll pour (default 500)")
    sub.add_parser("demo", help="load sample beers onto the taps")
    sub.add_parser("serve", help="run API + UI locally without Docker")
    sub.add_parser("init", help=argparse.SUPPRESS)

    args = p.parse_args(argv)
    cfg = config_mod.load()
    db = Database(cfg.db_path)
    db.init([t.id for t in cfg.taps])

    handlers = {
        None: cmd_status, "status": cmd_status, "beers": cmd_beers, "ls": cmd_beers, "list": cmd_beers,
        "add": cmd_add, "edit": cmd_edit, "rm": cmd_rm, "tap": cmd_tap, "kick": cmd_kick,
        "level": cmd_level, "kegs": cmd_kegs, "export": cmd_export, "import": cmd_import,
        "demo": cmd_demo, "serve": cmd_serve, "calibrate": cmd_calibrate, "init": cmd_init, "logo": cmd_logo,
    }
    try:
        handlers[args.cmd](db, cfg, args)
    except KeyboardInterrupt:
        print()
        sys.exit(130)


if __name__ == "__main__":
    main()
