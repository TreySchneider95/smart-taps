/* Guest-facing chalkboard: polls /api/state and keeps each tap's keg gauge in sync. */
(function () {
  const POLL_MS = 1000;
  const VOLUME = {
    gal: (ml) => `${(ml / 3785.41).toFixed(1)} gal`,
    pint: (ml) => { const n = Math.floor(ml / 473.176); return `${n} pint${n === 1 ? "" : "s"}`; },
    l: (ml) => `${(ml / 1000).toFixed(1)} L`,
  };

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const app = (window.Taps = {
    meta: null,
    state: null,
    listeners: [],
    onState(fn) { this.listeners.push(fn); },
    esc,
  });

  if (new URLSearchParams(location.search).has("kiosk")) document.body.classList.add("kiosk");
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- helpers shared with the console ----------
  app.tappedAgo = function (iso) {
    if (!iso) return "";
    const then = new Date(iso);
    const days = Math.floor((Date.now() - then) / 86400000);
    if (days < 1) return "Tapped today";
    if (days === 1) return "Tapped yesterday";
    if (days < 14) return `Tapped ${days} days ago`;
    return "Tapped " + then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  app.remainingText = function (tap) {
    const fmt = VOLUME[app.meta?.volume_unit] || VOLUME.gal;
    return `≈ ${fmt(tap.keg?.remaining_ml || 0)} left`;
  };

  app.medallionHTML = function (beer, tapId) {
    return beer && beer.logo_url
      ? `<div class="medallion has-logo"><img class="medallion__logo" src="${esc(beer.logo_url)}" alt=""></div>`
      : `<div class="medallion"><div class="medallion__inner">${tapId}</div></div>`;
  };

  // ---------- appearance: background theme + warmth (picked in the console) ----------
  // Each theme is [hue, saturation%] at its coolest, neutral and warmest. Warmth (-5..5)
  // blends from neutral toward one end; every background shade is then that hue/saturation
  // at a fixed lightness, so the board stays just as dark whatever you pick.
  const THEMES = {
    olive:    { label: "Olive",     cool: [100, 22], base: [74, 26],  warm: [50, 30] },
    plum:     { label: "Deep Plum", cool: [282, 18], base: [320, 20], warm: [348, 24] },
    charcoal: { label: "Charcoal",  cool: [212, 13], base: [40, 5],   warm: [28, 17] },
  };
  const SHADES = {
    "--slate": 16, "--slate-deep": 12.5, "--panel": 19.5, "--panel-hi": 23.5,
    "--board-hi": 21.5, "--keg-body": 8.8, "--keg-edge": 5.5,
  };

  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  }
  function rgbToHueSat([r, g, b]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    if (!d) return [0, 0];
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, (d / (1 - Math.abs(2 * l - 1))) * 100];
  }
  const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

  app.THEMES = THEMES;
  app.themePalette = function (theme, warmth) {
    const t = THEMES[theme] || THEMES.olive;
    const w = Math.max(-5, Math.min(5, Number(warmth) || 0)) / 5;
    // blend in RGB (not hue) so e.g. charcoal goes warm-grey -> neutral -> blue-grey without passing through green
    const from = hslToRgb(...t.base, 16);
    const to = hslToRgb(...(w < 0 ? t.cool : t.warm), 16);
    const [h, sat] = rgbToHueSat(from.map((v, i) => v + (to[i] - v) * Math.abs(w)));
    return Object.fromEntries(Object.entries(SHADES).map(([k, l]) => [k, toHex(hslToRgb(h, sat, l))]));
  };

  // Paints the page. The console calls this directly to preview while you drag the slider.
  app.paintAppearance = function (a) {
    if (!a) return;
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(app.themePalette(a.theme, a.warmth))) root.setProperty(k, v);
  };

  let appearanceKey = null;
  let holdUntil = 0; // after a save, ignore polls that were already in flight with the old value
  app.holdAppearance = () => { holdUntil = Date.now() + 2000; };
  function applyAppearance(a, force = false) {
    const key = a && `${a.theme}|${a.warmth}|${a.scene}|${a.surprises}`;
    if (!a || (!force && (key === appearanceKey || Date.now() < holdUntil))) return; // only repaint when the saved setting changes
    appearanceKey = key;
    app.paintAppearance(a);
    app.scenery?.set(a);
    try { localStorage.setItem("taps.appearance", JSON.stringify(a)); } catch {}
  }
  app.applyAppearance = applyAppearance;
  // paint the last-known theme straight away so a reload doesn't flash olive first
  try { app.paintAppearance(JSON.parse(localStorage.getItem("taps.appearance"))); } catch {}

  // ---------- tap columns ----------
  const cols = new Map(); // tap id -> { el, key }

  function subLine(b) {
    const what = b.style || b.kind;
    return [what, b.abv != null ? `${Number(b.abv).toFixed(1).replace(/\.0$/, "")}% ABV` : null].filter(Boolean).join(" · ");
  }

  // A handful of bubbles hugging the keg's sides, each with its own size, pace and start.
  // how many bubbles, and how long each one's cycle is (Appearance → Keg bubbles)
  const FIZZ = { few: { n: 3, d: [13, 22] }, some: { n: 6, d: [9, 16] }, lots: { n: 14, d: [5, 10] } };
  const fizzLevel = () => (FIZZ[app.state?.appearance?.fizz] ? app.state.appearance.fizz : "some");

  function bubblesHTML() {
    const rand = (lo, hi) => lo + Math.random() * (hi - lo);
    const { n, d: [lo, hi] } = FIZZ[fizzLevel()];
    return Array.from({ length: n }, (_, i) => {
      const x = i % 2 ? rand(72, 88) : rand(5, 20); // alternate left / right edge (%)
      const d = rand(lo, hi);                        // full cycle in seconds (rising is ~40% of it)
      return `<i style="--x:${x.toFixed(1)}%;--s:${rand(2.5, 5.5).toFixed(1)}px;--d:${d.toFixed(1)}s;--t:${(-rand(0, d)).toFixed(1)}s"></i>`;
    }).join("");
  }

  function columnKey(tap) {
    const b = tap.beer;
    return [b?.id, b?.name, b?.style, b?.kind, b?.abv, b?.color_hex, b?.logo_url, !!tap.co2, fizzLevel()].join("|");
  }

  function columnHTML(tap) {
    const b = tap.beer;
    const charge = tap.co2 && b ? `
      <button class="charge-btn" type="button">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/>
          <path d="M12 3v6M12 15v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <span class="charge-label">Charge CO2</span>
      </button>` : "";
    return `
      ${app.medallionHTML(b, tap.id)}
      <div>
        <h2 class="tap__name"><span>${b ? esc(b.name) : "Tapped Out"}</span></h2>
        <div class="tap__sub">${b ? esc(subLine(b)) : "Next one soon"}</div>
      </div>
      <div class="gauge-wrap">
        <div class="keg"><div class="keg__fill"><div class="keg__bubbles">${bubblesHTML()}</div></div></div>
        <div class="tap__pct"></div>
        <div class="tap__amt"></div>
      </div>
      <div class="tap__footer">${charge}</div>`;
  }

  function updateColumn(el, tap) {
    const b = tap.beer;
    if (b) el.style.setProperty("--pour", b.color_hex);
    else el.style.removeProperty("--pour");
    el.classList.toggle("empty", !b);
    el.classList.toggle("pouring", !!tap.pouring);
    el.classList.toggle("still", !!b && b.bubbles === false);

    const pct = b && tap.keg ? Math.max(0, Math.min(1, tap.keg.remaining_pct ?? 0)) : 0;
    const fill = $(".keg__fill", el);
    fill.style.setProperty("--level", `${pct * 100}%`);
    // shorter column -> quicker trip to the top; stepped so pours don't make bubbles jump
    fill.style.setProperty("--rise", Math.max(0.3, Math.ceil(pct * 10) / 10));
    el.classList.toggle("low", !!b && pct < 0.15);
    $(".tap__pct", el).textContent = b ? `${Math.round(pct * 100)}%` : "—";
    $(".tap__amt", el).textContent = !b ? "" : tap.pouring ? "Pouring…" : app.remainingText(tap);

    const btn = $(".charge-btn", el);
    if (btn && !btn.dataset.busy) {
      const active = !!tap.co2?.active;
      btn.classList.toggle("is-charging", active);
      $(".charge-label", btn).textContent = active ? "Charging…" : "Charge CO2";
    }
  }

  async function charge(tap, btn) {
    if (btn.dataset.busy || btn.classList.contains("is-charging")) return;
    btn.dataset.busy = "1";
    btn.classList.add("is-charging");
    $(".charge-label", btn).textContent = "Charging…";
    try {
      const res = await fetch(`/api/taps/${tap.id}/co2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: tap.co2.boost_seconds?.[0] ?? 2 }),
      });
      if (!res.ok) throw new Error();
    } catch {
      btn.classList.remove("is-charging");
      btn.classList.add("is-waiting");
      $(".charge-label", btn).textContent = "One sec…";
      await new Promise((r) => setTimeout(r, 1500));
      btn.classList.remove("is-waiting");
    } finally {
      delete btn.dataset.busy; // the next poll shows the relay's real state
    }
  }

  function render(state) {
    const root = $("#taps");
    for (const tap of state.taps) {
      let col = cols.get(tap.id);
      if (!col) {
        const el = document.createElement("section");
        el.className = "tap";
        el.dataset.tap = tap.id;
        root.appendChild(el);
        col = { el, key: null };
        cols.set(tap.id, col);
      }
      const key = columnKey(tap);
      if (col.key !== key) {
        col.key = key;
        col.el.innerHTML = columnHTML(tap);
        const btn = $(".charge-btn", col.el);
        if (btn) btn.addEventListener("click", () => charge(app.state.taps.find((t) => t.id === tap.id), btn));
      }
      updateColumn(col.el, tap);
    }
  }

  // ---------- header ----------
  function renderTemp(t) {
    const el = $("#temp");
    if (!t) { el.hidden = true; return; }
    el.hidden = false;
    el.dataset.status = t.status;
    $("#tempVal").textContent = t.value == null ? "--" : `${Math.round(t.value)}°${t.unit}`;
    $("#tempLabel").textContent =
      t.status === "warm" ? "Running warm" : t.status === "error" ? "Sensor offline" :
      t.status === "stale" ? "Sensor stale" : "Cabinet Temp";
  }

  // ---------- polling ----------
  let bootId = null;
  let failures = 0;

  async function poll() {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const state = await res.json();
      // server restarted with (possibly) new code -> reload the kiosk
      if (bootId && state.boot_id !== bootId) return location.reload();
      bootId = state.boot_id;
      failures = 0;
      $("#offline").hidden = true;
      app.state = state;
      applyAppearance(state.appearance);
      renderTemp(state.temperature);
      render(state);
      app.listeners.forEach((fn) => fn(state));
    } catch (e) {
      if (++failures > 3) $("#offline").hidden = false;
    } finally {
      setTimeout(poll, POLL_MS);
    }
  }

  async function boot() {
    try {
      app.meta = await (await fetch("/api/meta")).json();
      $("#barName").textContent = app.meta.bar.name;
      $("#barTag").textContent = app.meta.bar.tagline;
      document.title = app.meta.bar.name;
      applyAppearance(app.meta.appearance);
    } catch (e) {
      return setTimeout(boot, 2000);
    }
    await document.fonts.ready;
    poll();
  }
  boot();
})();
