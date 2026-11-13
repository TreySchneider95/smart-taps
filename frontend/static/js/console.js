/* On-screen management console: swap beers, kick kegs, boost CO2. No typing required. */
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
    mode: "overview",     // overview | picker | confirm | appearance
    filter: "recent",
    beers: [],
    chosen: null,
    kegKey: null,
    fresh: true,
    kickArmed: false,
    lastDetailKey: "",
    look: null,           // appearance being edited: { theme, warmth }
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
    consoleEl.hidden = false;
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
    clearTimeout(idleTimer);
    app.applyAppearance(app.state?.appearance, true); // drop any unsaved preview
  }

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
    if (!ui.unlocked) return renderPin();
    body.innerHTML = `<div class="tap-list" id="tapList"></div><div class="detail" id="detail"></div>`;
    renderTapList();
    renderDetail();
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
    const looking = ui.mode === "appearance";
    const key = JSON.stringify([ui.tapId, looking, app.state.taps.map((t) => [t.beer?.id, t.beer?.name, t.beer?.logo_url, t.keg?.id, t.keg && Math.round(t.keg.remaining_pct * 100)])]);
    if (!force && key === tapListKey) return;
    tapListKey = key;
    list.innerHTML = app.state.taps.map((t) => {
      const b = t.beer;
      const pct = b && t.keg ? t.keg.remaining_pct : null;
      return `
        <button class="tap-card ${t.id === ui.tapId && !looking ? "selected" : ""}" data-tap="${t.id}" ${b ? `style="--pour:${b.color_hex}"` : ""}>
          ${app.medallionHTML(b, t.id)}
          <div style="flex:1;min-width:0">
            <div class="t-name">${b ? esc(b.name) : "Empty"}</div>
            <div class="t-sub">${b ? esc([b.style, b.abv != null ? b.abv + "%" : null].filter(Boolean).join(" · ")) : "Nothing on tap"}</div>
            ${pct != null ? `<div class="mini-meter"><i style="width:${pct * 100}%"></i></div>` : ""}
          </div>
        </button>`;
    }).join("") + `
      <button class="tap-card ${looking ? "selected" : ""}" id="lookCard">
        <span class="look-dot"></span>
        <div style="flex:1;min-width:0">
          <div class="t-name">Appearance</div>
          <div class="t-sub">Background color</div>
        </div>
      </button>`;
    $("#lookCard", list).addEventListener("click", () => {
      ui.mode = "appearance";
      ui.kickArmed = false;
      ui.look = { ...(app.state?.appearance || { theme: "olive", warmth: 0 }) };
      render();
    });
    list.querySelectorAll(".tap-card[data-tap]").forEach((c) =>
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
    if (d && ui.mode === "appearance") return renderAppearance(d);
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
    const btns = t.co2.boost_seconds.map((s) => `<button class="btn copper" data-boost="${s}" ${t.co2.active ? "disabled" : ""}>${s}s</button>`).join("");
    return `
      <div class="panel-row ${t.co2.active ? "active" : ""}">
        <div class="label">
          <b>Charge CO2${t.co2.active ? " · charging…" : ""}</b>
          <div>A quick shot of gas to push it through the line.</div>
        </div>
        ${btns}
      </div>`;
  }

  function wireCo2(d, t) {
    d.querySelectorAll("[data-boost]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          const r = await api(`/api/taps/${t.id}/co2`, { seconds: Number(btn.dataset.boost) });
          toast(`CO₂ boost · ${r.seconds}s`);
        } catch (e) { toast(e.message, true); }
      })
    );
  }

  // ---------- appearance ----------
  function warmthLabel(w) {
    return w === 0 ? "Neutral" : `${w < 0 ? "Cooler" : "Warmer"} ${Math.abs(w)}`;
  }

  function renderAppearance(d) {
    const look = ui.look;
    const cards = Object.entries(app.THEMES).map(([key, th]) => `
      <button class="theme-card ${look.theme === key ? "on" : ""}" data-theme="${key}">
        <span class="theme-swatch"></span>
        <span class="theme-name">${esc(th.label)}</span>
      </button>`).join("");
    d.innerHTML = `
      <div class="eyebrow">Display</div>
      <h2>Appearance</h2>
      <div class="sub">Background color for the tap board. Changes show right away.</div>
      <div class="field-label" style="margin-top:24px">Color</div>
      <div class="theme-cards">${cards}</div>
      <div class="field-label" style="margin-top:26px">Warmth</div>
      <div class="warmth">
        <span>Cooler</span>
        <input type="range" id="warmth" min="-5" max="5" step="1" value="${look.warmth}" aria-label="Warmth">
        <span>Warmer</span>
      </div>
      <div class="warmth" style="justify-content:center;margin-top:4px"><span class="warmth-value" id="warmthValue">${warmthLabel(look.warmth)}</span></div>
      <div style="margin-top:24px">
        <button class="btn ghost" id="resetLook">Reset to olive, neutral</button>
      </div>`;
    paintSwatches(d);

    d.querySelectorAll("[data-theme]").forEach((c) =>
      c.addEventListener("click", () => {
        if (look.theme === c.dataset.theme) return;
        look.theme = c.dataset.theme;
        d.querySelectorAll("[data-theme]").forEach((x) => x.classList.toggle("on", x === c));
        app.paintAppearance(look);
        saveLook();
      })
    );
    const slider = $("#warmth", d);
    slider.addEventListener("input", () => {   // live preview while dragging
      look.warmth = Number(slider.value);
      $("#warmthValue", d).textContent = warmthLabel(look.warmth);
      paintSwatches(d);
      app.paintAppearance(look);
    });
    slider.addEventListener("change", saveLook); // save when you let go
    $("#resetLook", d).addEventListener("click", () => {
      ui.look = { theme: "olive", warmth: 0 };
      app.paintAppearance(ui.look);
      saveLook();
      renderAppearance(d);
    });
  }

  // each card previews its theme at the current warmth
  function paintSwatches(d) {
    d.querySelectorAll("[data-theme]").forEach((c) => {
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
    return JSON.stringify([t.beer?.id, t.beer?.logo_url, t.beer?.bubbles, t.keg?.id, t.keg && Math.round(t.keg.remaining_pct * 100), t.co2?.active]);
  }

  app.onState(() => {
    if (!ui.open || !ui.unlocked) return;
    renderTapList(false);
    const t = tap();
    if (ui.mode === "overview" && t && detailKey(t) !== ui.lastDetailKey) renderDetail();
  });
})();
