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

  // ---------- tap columns ----------
  const cols = new Map(); // tap id -> { el, key }

  function subLine(b) {
    const what = b.style || b.kind;
    return [what, b.abv != null ? `${Number(b.abv).toFixed(1).replace(/\.0$/, "")}% ABV` : null].filter(Boolean).join(" · ");
  }

  function columnKey(tap) {
    const b = tap.beer;
    return [b?.id, b?.name, b?.style, b?.kind, b?.abv, b?.color_hex, b?.logo_url, !!tap.co2].join("|");
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
        <div class="keg"><div class="keg__fill"></div></div>
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

    const pct = b && tap.keg ? Math.max(0, Math.min(1, tap.keg.remaining_pct ?? 0)) : 0;
    $(".keg__fill", el).style.setProperty("--level", `${pct * 100}%`);
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
    } catch (e) {
      return setTimeout(boot, 2000);
    }
    await document.fonts.ready;
    poll();
  }
  boot();
})();
