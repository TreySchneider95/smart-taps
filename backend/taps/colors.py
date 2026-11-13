"""Turn a beer's SRM (or a wine's color word) into a display color."""
from __future__ import annotations

# Standard SRM -> sRGB approximations (index = SRM 1..40)
_SRM_HEX = [
    "#FFE699", "#FFD878", "#FFCA5A", "#FFBF42", "#FBB123", "#F8A600", "#F39C00", "#EA8F00",
    "#E58500", "#DE7C00", "#D77200", "#CF6900", "#CB6200", "#C35900", "#BB5100", "#B54C00",
    "#B04500", "#A63E00", "#A13700", "#9B3200", "#952D00", "#8E2900", "#882300", "#821E00",
    "#7B1A00", "#771900", "#701400", "#6A0E00", "#660D00", "#5E0B00", "#5A0A02", "#600903",
    "#520907", "#4C0505", "#470606", "#440607", "#3F0708", "#3B0607", "#3A070B", "#36080A",
]

# Words people actually use -> SRM
BEER_WORDS = {
    "straw": 2, "pale": 3, "light": 3, "gold": 5, "golden": 5, "hazy": 5,
    "amber": 10, "copper": 14, "red": 17, "brown": 22, "dark": 30, "black": 40, "stout": 40,
}

WINE_COLORS = {
    "red": "#6E0F24",
    "white": "#E9D98B",
    "rose": "#E8889A",
    "rosé": "#E8889A",
    "orange": "#D9902F",
    "sparkling": "#F1E2A8",
}

KIND_DEFAULTS = {
    "beer": "#E58500",
    "wine": WINE_COLORS["red"],
    "cider": "#F2C14E",
    "seltzer": "#E8F1EE",
    "kombucha": "#C9884A",
    "cold brew": "#2B160C",
    "soda": "#7A2E1A",
    "other": "#C9A24A",
}

KINDS = list(KIND_DEFAULTS)

STILL_KINDS = {"wine", "cold brew", "other"}


def has_bubbles(kind: str | None, color: str | None, bubbles: int | None) -> bool:
    """Whether the keg gauge shows bubbles. An explicit setting wins; otherwise go by the kind."""
    if bubbles is not None:
        return bool(bubbles)
    if (color or "").strip().lower() == "sparkling":
        return True
    return (kind or "beer").lower() not in STILL_KINDS


def srm_to_hex(srm: float) -> str:
    i = max(1, min(40, round(srm)))
    return _SRM_HEX[i - 1]


def display_color(kind: str, srm: float | None, color: str | None) -> str:
    if color:
        c = color.strip().lower()
        if c.startswith("#") and len(c) in (4, 7):
            return c
        if c in WINE_COLORS:
            return WINE_COLORS[c]
        if c in BEER_WORDS:
            return srm_to_hex(BEER_WORDS[c])
    if srm:
        return srm_to_hex(srm)
    return KIND_DEFAULTS.get(kind, KIND_DEFAULTS["other"])


def color_label(kind: str, srm: float | None, color: str | None) -> str | None:
    """Short human label shown next to the swatch."""
    if color and not color.startswith("#"):
        return color.strip().capitalize()
    if srm:
        return f"SRM {srm:g}"
    return None


def parse_color_input(text: str, kind: str = "beer") -> tuple[float | None, str | None]:
    """CLI helper -> (srm, color).

    '12' -> srm 12, 'amber' -> srm 10, '#aabbcc' -> color, and for wine 'red'/'white'/'rose' -> color.
    """
    t = text.strip().lower()
    if not t:
        return None, None
    try:
        return float(t), None
    except ValueError:
        pass
    if t.startswith("#"):
        return None, t
    if kind != "beer" and t in WINE_COLORS:
        return None, t
    if t in BEER_WORDS:
        return float(BEER_WORDS[t]), None
    if t in WINE_COLORS:
        return None, t
    raise ValueError(f"Don't know the color {text!r}. Try an SRM number, a word like 'amber', or #hex.")
