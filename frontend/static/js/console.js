/* On-screen management console: swap beers, kick kegs, boost CO2, and (from the header)
   pick the board's appearance and seasonal scene. No typing required. */
(function () {
  const app = window.Taps;
  const esc = app.esc;
  const $ = (s, el = document) => el.querySelector(s);
  const IDLE_CLOSE_MS = 120000;

  const ui = {
    open: false,
    pin: "",
    unlocked: false,
    entry: "",
    tapId: null,
    screen: "taps",       // taps | appearance
    mode: "overview",     // overview | picker | confirm  (on the taps screen)
    filter: "recent",
    beers: [],
    chosen: null,
    kegKey: null,
    fresh: true,
    kickArmed: false,
    lastDetailKey: "",
    look: null,           // appearance being edited: { theme, warmth, scene, surprises }
  };

  const consoleEl = $("#console");
  const body = $("#consoleBody");
  let idleTimer;

  // ---------- plumbing ----------
  async function api(path, data) {
    const res = await fetch(path, {
      method: data === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Pin": ui.pin },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) { ui.unlocked = false; ui.pin = ""; render(); }
    if (!res.ok) throw new Error(json.detail || `Error ${res.status}`);
    return json;
  }

  let toastTimer;
  function toast(msg, error = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("error", error);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  function bumpIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, IDLE_CLOSE_MS);
  }

  function swatch(b) {
    return b.logo_url ? `<img class="swatch" src="${esc(b.logo_url)}" alt="">` : `<span class="swatch"></span>`;
  }

  function tap() {
    return app.state?.taps.find((t) => t.id === ui.tapId);
  }

  // ---------- open / close ----------
  function open() {
    ui.open = true;
    ui.unlocked = !app.meta?.pin_required;
    ui.pin = "";
    ui.entry = "";
    ui.tapId = ui.tapId ?? app.state?.taps[0]?.id ?? 1;
    ui.mode = "overview";
    ui.screen = "taps";
    consoleEl.hidden = false;
    document.body.classList.add("console-open");
    const foot = $("#consoleFoot");
    const ssh = app.meta?.ssh_target ? `<code>ssh ${esc(app.meta.ssh_target)}</code>` : "SSH into the Pi";
    foot.innerHTML = `New beer? From your Mac: ${ssh} then <code>cd smart-taps &amp;&amp; ./taps add</code>`;
    render();
    bumpIdle();
  }

  function close() {
    ui.open = false;
    ui.unlocked = false;
    ui.pin = "";
    consoleEl.hidden = true;
    document.body.classList.remove("console-open");
    clearTimeout(idleTimer);
    app.applyAppearance(app.state?.appearance, true); // drop any unsaved preview
  }

  const navBtn = $("#consoleNav");
  const PALETTE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-.8-1.6-.8-2.6c0-1.2 1-2 2.2-2H18a3 3 0 0 0 3-3c0-4.6-4-8.4-9-8.4z"/><circle cx="7.5" cy="11" r="1.3" fill="currentColor"/><circle cx="10.5" cy="7" r="1.3" fill="currentColor"/><circle cx="15" cy="7.5" r="1.3" fill="currentColor"/></svg>`;
  navBtn.addEventListener("click", () => {
    ui.screen = ui.screen === "taps" ? "appearance" : "taps";
    ui.look = { ...DEFAULT_LOOK, ...(app.state?.appearance || {}) };
    ui.kickArmed = false;
    render();
  });

  $("#openConsole").addEventListener("click", open);
  $("#closeConsole").addEventListener("click", close);
  consoleEl.addEventListener("pointerdown", bumpIdle);

  // http://<pi>:8000/?console opens straight into the console (handy from a phone)
  if (new URLSearchParams(location.search).has("console")) {
    const wait = setInterval(() => { if (app.state) { clearInterval(wait); open(); } }, 100);
  }

  // ---------- rendering ----------
  function render() {
    if (!ui.open) return;
    renderHead();
    if (!ui.unlocked) return renderPin();
    if (ui.screen === "appearance") {
      body.innerHTML = `<div class="look-screen" id="look"></div>`;
      return renderAppearance($("#look"));
    }
    body.innerHTML = `<div class="tap-list" id="tapList"></div><div class="detail" id="detail"></div>`;
    renderTapList();
    renderDetail();
  }

  function renderHead() {
    const looking = ui.screen === "appearance";
    $("#consoleEyebrow").textContent = looking ? "Settings" : "Management";
    $("#consoleTitle").textContent = looking ? "Appearance" : "Tap Console";
    navBtn.hidden = !ui.unlocked;
    navBtn.innerHTML = looking ? "‹ Taps" : `${PALETTE}Appearance`;
  }

  function renderPin(shake = false) {
    const len = app.meta?.pin_length || 4;
    const dots = Array.from({ length: len }, (_, i) => `<i class="${i < ui.entry.length ? "on" : ""}"></i>`).join("");
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"]
      .map((k) => (k === "" ? "<span></span>" : `<button data-k="${k}">${k}</button>`)).join("");
    body.innerHTML = `
      <div class="pinpad">
        <div class="eyebrow">Enter PIN</div>
        <div class="pin-dots ${shake ? "shake" : ""}">${dots}</div>
        <div class="keys">${keys}</div>
      </div>`;
    body.querySelectorAll("[data-k]").forEach((b) =>
      b.addEventListener("click", async () => {
        const k = b.dataset.k;
        ui.entry = k === "⌫" ? ui.entry.slice(0, -1) : (ui.entry + k).slice(0, len);
        if (ui.entry.length < len) return renderPin();
        try {
          await api("/api/unlock", { pin: ui.entry });
          ui.pin = ui.entry;
          ui.unlocked = true;
          ui.entry = "";
          render();
        } catch {
          ui.entry = "";
          renderPin(true);
        }
      })
    );
  }

  let tapListKey = "";
  function renderTapList(force = true) {
    const list = $("#tapList");
    if (!list || !app.state) return;
    const key = JSON.stringify([ui.tapId, app.state.taps.map((t) => [t.beer?.id, t.beer?.name, t.beer?.logo_url, t.keg?.id, t.keg && Math.round(t.keg.remaining_pct * 100)])]);
    if (!force && key === tapListKey) return;
    tapListKey = key;
    list.innerHTML = app.state.taps.map((t) => {
      const b = t.beer;
      const pct = b && t.keg ? t.keg.remaining_pct : null;
      return `
        <button class="tap-card ${t.id === ui.tapId ? "selected" : ""}" data-tap="${t.id}" ${b ? `style="--pour:${b.color_hex}"` : ""}>
          ${app.medallionHTML(b, t.id)}
          <div style="flex:1;min-width:0">
            <div class="t-name">${b ? esc(b.name) : "Empty"}</div>
            <div class="t-sub">${b ? esc([b.style, b.abv != null ? b.abv + "%" : null].filter(Boolean).join(" · ")) : "Nothing on tap"}</div>
            ${pct != null ? `<div class="mini-meter"><i style="width:${pct * 100}%"></i></div>` : ""}
          </div>
        </button>`;
    }).join("");
    list.querySelectorAll(".tap-card").forEach((c) =>
      c.addEventListener("click", () => {
        ui.tapId = Number(c.dataset.tap);
        ui.mode = "overview";
        ui.kickArmed = false;
        render();
      })
    );
  }

  function renderDetail() {
    const d = $("#detail");
    const t = tap();
    if (!d || !t) return;
    ui.lastDetailKey = detailKey(t);
    if (ui.mode === "picker") return renderPicker(d, t);
    if (ui.mode === "confirm") return renderConfirm(d, t);

    const b = t.beer;
    if (!b) {
      d.innerHTML = `
        <div class="eyebrow">Tap ${t.id}</div>
        <h2>Empty</h2>
        <div class="sub">Nothing flowing here right now.</div>
        <div style="margin-top:28px" class="actions">
          <button class="btn primary big wide" id="change">Put a beer on tap ${t.id}</button>
        </div>
        ${co2HTML(t)}`;
    } else {
      const facts = [];
      if (t.keg) facts.push(["Tapped", app.tappedAgo(t.keg.tapped_at).replace(/^Tapped /, "")]);
      if (t.keg) facts.push([t.flow_enabled ? "Left" : "Left (est.)", `${Math.round(t.keg.remaining_pct * 100)}% · ${app.remainingText(t).replace(" left", "")}`]);
      if (t.keg) facts.push(["Keg", `${(t.keg.size_ml / 1000).toFixed(1)} L`]);
      d.innerHTML = `
        <div class="eyebrow">Tap ${t.id} · on now</div>
        <h2>${esc(b.name)}</h2>
        <div class="sub">${esc([b.maker, b.style, b.abv != null ? b.abv + "% ABV" : null].filter(Boolean).join(" · "))}</div>
        <div class="facts">${facts.map(([k, v]) => `<div class="fact"><small>${k}</small><b>${esc(v)}</b></div>`).join("")}</div>
        <div class="actions">
          <button class="btn primary big wide" id="change">Change beer</button>
          <button class="btn big" id="fresh">Fresh keg, same beer</button>
          <button class="btn big danger ${ui.kickArmed ? "confirm" : ""}" id="kick">${ui.kickArmed ? "Tap again to confirm" : "Tapped out"}</button>
        </div>
        ${levelHTML(t)}
        ${bubbleToggleHTML(b)}
        ${co2HTML(t)}`;
      d.querySelectorAll("[data-level]").forEach((c) =>
        c.addEventListener("click", async () => {
          try {
            await api(`/api/taps/${t.id}/level`, { percent: Number(c.dataset.level) });
            toast(`Tap ${t.id} set to ${c.dataset.level}%`);
          } catch (e) { toast(e.message, true); }
        })
      );
      d.querySelectorAll("[data-bubbles]").forEach((c) =>
        c.addEventListener("click", async () => {
          const on = c.dataset.bubbles === "1";
          if (on === b.bubbles) return;
          try {
            await api(`/api/beers/${b.id}/bubbles`, { on });
            toast(on ? `Bubbles on for ${b.name}` : `${b.name} is still now`);
          } catch (e) { toast(e.message, true); }
        })
      );
      $("#fresh", d).addEventListener("click", () => {
        ui.chosen = app.state.taps.find((x) => x.id === t.id).beer;
        ui.fresh = true;
        ui.kegKey = null;
        ui.mode = "confirm";
        renderDetail();
      });
      $("#kick", d).addEventListener("click", async () => {
        if (!ui.kickArmed) {
          ui.kickArmed = true;
          renderDetail();
          setTimeout(() => { if (ui.kickArmed) { ui.kickArmed = false; renderDetail(); } }, 4000);
          return;
        }
        ui.kickArmed = false;
        try {
          await api(`/api/taps/${t.id}/kick`, {});
          toast(`Tap ${t.id} is tapped out`);
        } catch (e) { toast(e.message, true); }
      });
    }
    $("#change", d).addEventListener("click", openPicker);
    wireCo2(d, t);
  }

  function levelHTML(t) {
    // Until flow meters are installed, the gauge is whatever you last set here.
    if (t.flow_enabled || !t.keg) return "";
    const chips = [100, 75, 50, 25, 10].map((p) => `<button class="chip" data-level="${p}">${p === 100 ? "Full" : p + "%"}</button>`).join("");
    return `
      <div class="panel-row">
        <div class="label"><b>How full is it?</b><div>No flow meter on this tap yet, so set the gauge by eye.</div></div>
        <div class="chips" style="margin:0">${chips}</div>
      </div>`;
  }

  function bubbleToggleHTML(b) {
    return `
      <div class="panel-row">
        <div class="label"><b>Bubbles</b><div>Fizz in the keg gauge. Turn off for still wine and the like.</div></div>
        <div class="chips" style="margin:0">
          <button class="chip ${b.bubbles ? "on" : ""}" data-bubbles="1">On</button>
          <button class="chip ${!b.bubbles ? "on" : ""}" data-bubbles="0">Off</button>
        </div>
      </div>`;
  }

  function co2HTML(t) {
    if (!t.co2) return "";
    const secs = t.co2.charge_seconds;
    const chips = t.co2.choices
      .map((s) => `<button class="chip ${s === secs ? "on" : ""}" data-charge-time="${s}">${s}s</button>`).join("");
    return `
      <div class="panel-row ${t.co2.active ? "active" : ""}">
        <div class="label">
          <b>Charge CO2${t.co2.active ? " · charging…" : ""}</b>
          <div>A quick shot of gas to push it through the line.</div>
        </div>
        <button class="btn copper" data-boost ${t.co2.active ? "disabled" : ""}>Charge · ${secs}s</button>
      </div>
      <div class="panel-row">
        <div class="label">
          <b>Charge time</b>
          <div>How long each charge opens the gas, here and on the main screen (max ${t.co2.max_seconds}s).</div>
        </div>
        <div class="chips" style="margin:0">${chips}</div>
      </div>`;
  }

  function wireCo2(d, t) {
    d.querySelectorAll("[data-boost]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          const r = await api(`/api/taps/${t.id}/co2`, {});
          toast(`CO₂ boost · ${r.seconds}s`);
        } catch (e) { toast(e.message, true); }
      })
    );
    d.querySelectorAll("[data-charge-time]").forEach((c) =>
      c.addEventListener("click", async () => {
        const seconds = Number(c.dataset.chargeTime);
        if (seconds === t.co2.charge_seconds) return;
        try {
          await api(`/api/taps/${t.id}/co2/seconds`, { seconds });
          t.co2.charge_seconds = seconds;
          renderDetail();
          toast(`Charge time · ${seconds}s`);
        } catch (e) { toast(e.message, true); }
      })
    );
  }

  // ---------- appearance (its own screen, from the header button) ----------
  const DEFAULT_LOOK = { theme: "olive", warmth: 0, scene: "auto", surprises: "lively", fizz: "some" };
  const FIZZ_HINTS = { few: "Just the odd bubble.", some: "A few bubbles now and then.", lots: "Plenty of fizz, all the time." };
  const ICONS = {
    off: `<circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 23L23 9" stroke="currentColor" stroke-width="2"/>`,
    auto: `<rect x="5" y="8" width="22" height="19" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 14H27M11 5v5M21 5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="20.5" r="2.6" fill="currentColor"/>`,
    spring: `<g fill="#F2A7C3">${[0, 72, 144, 216, 288].map((a) => `<circle cx="16" cy="9.5" r="5" transform="rotate(${a} 16 16)"/>`).join("")}</g><circle cx="16" cy="16" r="3.6" fill="#F7D44C"/>`,
    summer: `<g stroke="#F4C430" stroke-width="2.2" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M16 3v4" transform="rotate(${a} 16 16)"/>`).join("")}</g><circle cx="16" cy="16" r="6.5" fill="#F4C430"/>`,
    fall: `<path d="M16 3L18.5 9L24 6.5L22 12.5L28 14L22.5 17L24 22L16 19.5L8 22L9.5 17L4 14L10 12.5L8 6.5L13.5 9Z" fill="#E07A2E"/><path d="M16 19V29" stroke="#E07A2E" stroke-width="2" stroke-linecap="round"/>`,
    winter: `<g stroke="#A9D6F0" stroke-width="2" stroke-linecap="round">${[0, 60, 120].map((a) => `<path d="M16 4V28M12 7l4 4l4-4M12 25l4-4l4 4" transform="rotate(${a} 16 16)" fill="none"/>`).join("")}</g>`,
  };
  const SURPRISE_HINTS = { calm: "Something every few minutes.", lively: "About once a minute.", party: "Something's always going on." };
  const cap = (w) => w[0].toUpperCase() + w.slice(1);

  function warmthLabel(w) {
    return w === 0 ? "Neutral" : `${w < 0 ? "Cooler" : "Warmer"} ${Math.abs(w)}`;
  }

  function renderAppearance(el) {
    const look = ui.look;
    const colorCards = Object.entries(app.THEMES).map(([key, th]) => `
      <button class="theme-card ${look.theme === key ? "on" : ""}" data-theme="${key}">
        <span class="theme-swatch"></span>
        <span class="theme-name">${esc(th.label)}</span>
      </button>`).join("");
    const now = app.scenery?.seasonOf() || "fall";
    // None, Auto, then every scene scenery.js knows about (seasons first, then themes)
    const scenes = [{ key: "off", label: "None" }, { key: "auto", label: "Auto" }, ...(app.scenery?.catalog || [])];
    const sceneCards = scenes.map(({ key, label, icon }) => `
      <button class="scene-card ${look.scene === key ? "on" : ""}" data-scene="${key}">
        <svg viewBox="0 0 32 32" aria-hidden="true">${icon || ICONS[key] || ""}</svg>
        <span class="name">${esc(label)}</span>
        ${key === "auto" ? `<span class="hint">Now: ${cap(now)}</span>` : ""}
      </button>`).join("");
    const chips = Object.keys(SURPRISE_HINTS)
      .map((k) => `<button class="chip ${look.surprises === k ? "on" : ""}" data-surprises="${k}">${cap(k)}</button>`).join("");
    const fizzChips = Object.keys(FIZZ_HINTS)
      .map((k) => `<button class="chip ${look.fizz === k ? "on" : ""}" data-fizz="${k}">${cap(k)}</button>`).join("");

    el.innerHTML = `
      <section class="look-section">
        <h3>Background color</h3>
        <div class="theme-cards">${colorCards}</div>
        <h3 style="margin-top:22px">Warmth</h3>
        <div class="warmth">
          <span>Cooler</span>
          <input type="range" id="warmth" min="-5" max="5" step="1" value="${look.warmth}" aria-label="Warmth">
          <span>Warmer</span>
        </div>
        <div class="warmth" style="justify-content:center;margin-top:2px"><span class="warmth-value" id="warmthValue">${warmthLabel(look.warmth)}</span></div>
        <h3 style="margin-top:20px">Keg bubbles</h3>
        <div class="chips" style="margin-bottom:6px">${fizzChips}</div>
        <div class="look-hint" id="fizzHint">${FIZZ_HINTS[look.fizz] || FIZZ_HINTS.some}</div>
        <button class="btn ghost" id="resetLook" style="margin-top:14px">Reset everything</button>
      </section>
      <section class="look-section">
        <h3>Season scene</h3>
        <div class="scene-cards">${sceneCards}</div>
        <h3 style="margin-top:22px">Surprises</h3>
        <div class="chips" style="margin-bottom:6px">${chips}</div>
        <div class="look-hint" id="surpriseHint">${SURPRISE_HINTS[look.surprises]}</div>
        <button class="btn primary" id="previewSurprise" style="margin-top:16px;width:100%" ${look.scene === "off" ? "disabled" : ""}>
          ${look.scene === "off" ? "Pick a scene to see surprises" : "Show me a surprise"}
        </button>
      </section>`;
    paintSwatches(el);

    el.querySelectorAll("[data-theme]").forEach((c) =>
      c.addEventListener("click", () => {
        if (look.theme === c.dataset.theme) return;
        look.theme = c.dataset.theme;
        el.querySelectorAll("[data-theme]").forEach((x) => x.classList.toggle("on", x === c));
        app.paintAppearance(look);
        saveLook();
      })
    );
    const slider = $("#warmth", el);
    slider.addEventListener("input", () => {   // live preview while dragging
      look.warmth = Number(slider.value);
      $("#warmthValue", el).textContent = warmthLabel(look.warmth);
      paintSwatches(el);
      app.paintAppearance(look);
    });
    slider.addEventListener("change", saveLook); // save when you let go
    el.querySelectorAll("[data-scene]").forEach((c) =>
      c.addEventListener("click", () => {
        if (look.scene === c.dataset.scene) return;
        look.scene = c.dataset.scene;
        saveLook();
        renderAppearance(el);
      })
    );
    el.querySelectorAll("[data-fizz]").forEach((c) =>
      c.addEventListener("click", () => {
        look.fizz = c.dataset.fizz;
        el.querySelectorAll("[data-fizz]").forEach((x) => x.classList.toggle("on", x === c));
        $("#fizzHint", el).textContent = FIZZ_HINTS[look.fizz];
        saveLook();
      })
    );
    el.querySelectorAll("[data-surprises]").forEach((c) =>
      c.addEventListener("click", () => {
        look.surprises = c.dataset.surprises;
        el.querySelectorAll("[data-surprises]").forEach((x) => x.classList.toggle("on", x === c));
        $("#surpriseHint", el).textContent = SURPRISE_HINTS[look.surprises];
        saveLook();
      })
    );
    $("#previewSurprise", el).addEventListener("click", () => {
      close();
      setTimeout(() => app.scenery?.play(), 500);
    });
    $("#resetLook", el).addEventListener("click", () => {
      ui.look = { ...DEFAULT_LOOK };
      app.paintAppearance(ui.look);
      saveLook();
      renderAppearance(el);
    });
  }

  // each color card previews its theme at the current warmth
  function paintSwatches(el) {
    el.querySelectorAll("[data-theme]").forEach((c) => {
      const p = app.themePalette(c.dataset.theme, ui.look.warmth);
      const sw = $(".theme-swatch", c);
      sw.style.setProperty("--sw", p["--slate"]);
      sw.style.setProperty("--sw-hi", p["--board-hi"]);
      sw.style.setProperty("--sw-deep", p["--slate-deep"]);
    });
  }

  async function saveLook() {
    try {
      const r = await api("/api/settings/appearance", ui.look);
      if (app.state) app.state.appearance = r.appearance;
      app.applyAppearance(r.appearance, true);
      app.holdAppearance();
    } catch (e) {
      toast(e.message, true);
      app.applyAppearance(app.state?.appearance, true);
    }
  }

  // ---------- picker ----------
  async function openPicker() {
    ui.mode = "picker";
    ui.filter = "recent";
    try {
      ui.beers = await api("/api/beers");
    } catch (e) { toast(e.message, true); }
    renderDetail();
  }

  function filteredBeers() {
    let list = ui.beers.slice();
    if (ui.filter === "az") list.sort((a, b) => a.name.localeCompare(b.name));
    if (ui.filter === "beer") list = list.filter((b) => b.kind === "beer");
    if (ui.filter === "wine") list = list.filter((b) => b.kind === "wine");
    if (ui.filter === "other") list = list.filter((b) => b.kind !== "beer" && b.kind !== "wine");
    return list;
  }

  function renderPicker(d, t) {
    const onTap = new Map(app.state.taps.filter((x) => x.beer).map((x) => [x.beer.id, x.id]));
    const chips = [["recent", "Recent"], ["az", "A – Z"], ["beer", "Beer"], ["wine", "Wine"], ["other", "Other"]]
      .map(([k, label]) => `<button class="chip ${ui.filter === k ? "on" : ""}" data-f="${k}">${label}</button>`).join("");
    const tiles = filteredBeers().map((b) => {
      const where = onTap.get(b.id);
      const sub = [b.style, b.abv != null ? b.abv + "%" : null, b.maker].filter(Boolean).join(" · ");
      const tag = where ? `On tap ${where}` : b.last_tapped_at ? app.tappedAgo(b.last_tapped_at).replace("Tapped", "Last on") : "New";
      return `
        <button class="beer-tile" data-id="${b.id}" style="--pour:${b.color_hex}">
          ${swatch(b)}
          <div style="min-width:0">
            <div class="tag">${esc(tag)}</div>
            <div class="b-name">${esc(b.name)}</div>
            <div class="b-sub">${esc(sub)}</div>
          </div>
        </button>`;
    }).join("");
    d.innerHTML = `
      <div class="picker-head">
        <button class="btn ghost" id="back">‹ Back</button>
        <div class="title">What's going on tap ${t.id}?</div>
      </div>
      <div class="chips">${chips}</div>
      <div class="beer-grid">${tiles || `<div class="empty-note">Nothing here yet. Add beers from your Mac with <code>taps add</code>.</div>`}</div>`;
    $("#back", d).addEventListener("click", () => { ui.mode = "overview"; renderDetail(); });
    d.querySelectorAll("[data-f]").forEach((c) => c.addEventListener("click", () => { ui.filter = c.dataset.f; renderDetail(); }));
    d.querySelectorAll(".beer-tile").forEach((tile) =>
      tile.addEventListener("click", () => {
        ui.chosen = ui.beers.find((b) => b.id === Number(tile.dataset.id));
        ui.fresh = true;
        ui.kegKey = null;
        ui.mode = "confirm";
        renderDetail();
      })
    );
  }

  // ---------- confirm ----------
  function renderConfirm(d, t) {
    const b = ui.chosen;
    const kegs = app.meta?.kegs || [];
    ui.kegKey = ui.kegKey || app.meta?.default_keg || "corny";
    const kegChips = kegs.map((k) => `<button class="chip ${k.key === ui.kegKey ? "on" : ""}" data-keg="${k.key}">${esc(k.label)}</button>`).join("");
    const canRelabel = !!t.keg && t.beer?.id !== b.id;
    d.innerHTML = `
      <div class="picker-head">
        <button class="btn ghost" id="back">‹ Back</button>
        <div class="title">Tap ${t.id}</div>
      </div>
      <div class="confirm-card" style="--pour:${b.color_hex}">
        ${swatch(b)}
        <div>
          <div class="b-name" style="font-size:42px;font-weight:700;line-height:1.05">${esc(b.name)}</div>
          <div class="sub">${esc([b.maker, b.style, b.abv != null ? b.abv + "%" : null].filter(Boolean).join(" · "))}</div>
        </div>
      </div>
      ${canRelabel ? `
        <div class="field-label">What happened?</div>
        <div class="chips">
          <button class="chip ${ui.fresh ? "on" : ""}" data-fresh="1">New keg (full)</button>
          <button class="chip ${!ui.fresh ? "on" : ""}" data-fresh="0">Just fix the label</button>
        </div>` : ""}
      ${ui.fresh ? `<div class="field-label">Keg size</div><div class="chips">${kegChips}</div>` : ""}
      <div style="margin-top:auto;padding-top:16px">
        <button class="btn primary big" style="width:100%" id="go">Tap it</button>
      </div>`;
    $("#back", d).addEventListener("click", () => { ui.mode = t.beer?.id === b.id && !canRelabel ? "overview" : "picker"; renderDetail(); });
    d.querySelectorAll("[data-keg]").forEach((c) => c.addEventListener("click", () => { ui.kegKey = c.dataset.keg; renderDetail(); }));
    d.querySelectorAll("[data-fresh]").forEach((c) => c.addEventListener("click", () => { ui.fresh = c.dataset.fresh === "1"; renderDetail(); }));
    $("#go", d).addEventListener("click", async () => {
      try {
        await api(`/api/taps/${t.id}/assign`, { beer_id: b.id, new_keg: ui.fresh, keg: ui.fresh ? ui.kegKey : null });
        toast(`Tap ${t.id} → ${b.name}`);
        ui.mode = "overview";
        ui.lastDetailKey = "";
      } catch (e) { toast(e.message, true); }
    });
  }

  // ---------- live updates while open ----------
  function detailKey(t) {
    return JSON.stringify([t.beer?.id, t.beer?.logo_url, t.beer?.bubbles, t.keg?.id, t.keg && Math.round(t.keg.remaining_pct * 100), t.co2?.active, t.co2?.charge_seconds]);
  }

  app.onState(() => {
    if (!ui.open || !ui.unlocked || ui.screen !== "taps") return;
    renderTapList(false);
    const t = tap();
    if (ui.mode === "overview" && t && detailKey(t) !== ui.lastDetailKey) renderDetail();
  });
})();
