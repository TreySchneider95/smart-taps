/* Scenery behind the tap board: a small ambient scene per season (grass, snow, falling
   leaves…) or theme (Husker football and volleyball, Traitors party), plus surprises that wander through now and then.
   To add a scene: an AMBIENT entry, a SURPRISES entry, a CATALOG row, and its key in
   SCENES in backend/taps/server.py.

   Everything lives in #scenery, underneath the taps, so it can never cover a name or a keg.
   Only transform and opacity are animated, which the Pi's GPU handles without breaking a
   sweat. Picked under Appearance in the console; `?scene=winter&surprise=santa` in the URL
   forces a scene / plays one surprise (handy for testing). */
(function () {
  const app = window.Taps;
  const layer = document.getElementById("scenery");
  const params = new URLSearchParams(location.search);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const f1 = (n) => (Math.round(n * 10) / 10).toString();

  // seconds between surprises
  const GAPS = { calm: [100, 200], lively: [30, 60], party: [9, 20] };

  // <svg> sized by height (vh) or width (vw); the other side follows the viewBox
  function svgH(vb, h, inner, attrs = "") {
    const [, , w, hh] = vb.split(" ").map(Number);
    return `<svg viewBox="${vb}" style="height:${f1(h)}vh;width:${f1((h * w) / hh)}vh" ${attrs}>${inner}</svg>`;
  }
  function svgW(vb, w, inner, attrs = "") {
    const [, , ww, h] = vb.split(" ").map(Number);
    return `<svg viewBox="${vb}" style="width:${f1(w)}vw;height:${f1((w * h) / ww)}vw" ${attrs}>${inner}</svg>`;
  }
  // gently rocking wrapper (rotate or skew around its bottom edge)
  function sway(html, style, { amp = 2, dur = 5, kind = "sc-sway" } = {}) {
    return `<div class="${kind}" style="${style};--amp:${f1(amp)}deg;--sd:${f1(dur)}s;--sdl:${f1(-rand(0, dur))}s">${html}</div>`;
  }

  // ================================================================ art
  const PAL = {
    grassSummer: ["#4E8A34", "#5E9C3E", "#6FAE48", "#467D2E"],
    grassSpring: ["#7DB356", "#6AA046", "#8CC063", "#5E9440"],
    grassFall: ["#B8963E", "#A07C35", "#C9A24A", "#8C7A3A"],
    leaves: ["#D9772B", "#C8462B", "#E0A43A", "#B5602B", "#B8A03A"],
    petals: ["#F2A7C3", "#F7D44C", "#F4F1E8", "#B999E0", "#F28C6B", "#8FC7F0"],
  };

  function grassClump(colors, n = 7) {
    let p = "";
    for (let i = 0; i < n; i++) {
      const x = rand(5, 55), lean = rand(-9, 9), ht = rand(18, 40), wb = rand(1.6, 2.6);
      p += `<path d="M${f1(x - wb)} 40Q${f1(x + lean * 0.35)} ${f1(40 - ht * 0.6)} ${f1(x + lean)} ${f1(40 - ht)}Q${f1(x + lean * 0.3 + 0.5)} ${f1(40 - ht * 0.5)} ${f1(x + wb)} 40Z" fill="${pick(colors)}"/>`;
    }
    return p;
  }
  function grassStrip(colors, h) {
    let out = "";
    const n = 18;
    for (let i = 0; i < n; i++) {
      const art = `<svg viewBox="0 0 60 40" preserveAspectRatio="none" style="width:8.5vw;height:${f1(h * rand(0.75, 1.1))}vh">${grassClump(colors)}</svg>`;
      out += sway(art, `left:${f1((i / n) * 100 - 3 + rand(-1.5, 1.5))}vw`, { amp: rand(4, 8), dur: rand(3, 5.5), kind: "sc-sway sc-skew" });
    }
    return out;
  }

  // things drifting down the whole screen on a loop (snow, leaves, petals)
  function fallers(n, art, { dur = [12, 20], drift = 3, spin = true } = {}) {
    let out = "";
    for (let i = 0; i < n; i++) {
      const d = rand(...dur), sd = rand(2.5, 5);
      const r = spin ? `--r0:${irand(-40, 40)}deg;--r1:${irand(140, 420)}deg` : "--r0:0deg;--r1:0deg";
      out += `<div class="sc-fall" style="left:${f1(rand(-2, 100))}vw;--dur:${f1(d)}s;--dl:${f1(-rand(0, d))}s">` +
        `<div class="sc-drift" style="--sw:${f1(rand(1, drift))}vw;--sd:${f1(sd)}s;--sdl:${f1(-rand(0, sd))}s;${r}">${art(i)}</div></div>`;
    }
    return out;
  }

  function leaf(c, h) {
    return Math.random() < 0.5
      ? svgH("0 0 20 20", h, `<path d="M10 1C16 5 17 13 10 19C3 13 4 5 10 1Z" fill="${c}"/><path d="M10 3V19" stroke="rgba(0,0,0,.25)" stroke-width=".9"/>`)
      : svgH("0 0 20 20", h, `<path d="M10 1L12 6L17 4L15 9L19 11L14 13L15 17L10 15L5 17L6 13L1 11L5 9L3 4L8 6Z" fill="${c}"/><path d="M10 15V20" stroke="rgba(0,0,0,.3)" stroke-width="1"/>`);
  }

  // a round tree whose crown pokes in from the right edge
  function edgeTree(crown, { blossoms = null } = {}) {
    const [c0, c1, c2, hi] = crown;
    let dots = "";
    if (blossoms) for (let i = 0; i < 34; i++) {
      dots += `<circle cx="${f1(rand(12, 140))}" cy="${f1(rand(16, 120))}" r="${f1(rand(2, 4.2))}" fill="${pick(blossoms)}"/>`;
    }
    const canopy = svgH("0 0 150 140", 25,
      `<circle cx="75" cy="74" r="46" fill="${c0}"/><circle cx="36" cy="84" r="32" fill="${c1}"/><circle cx="114" cy="82" r="32" fill="${c0}"/>` +
      `<circle cx="55" cy="46" r="32" fill="${c2}"/><circle cx="98" cy="44" r="30" fill="${c1}"/><circle cx="75" cy="100" r="34" fill="${c1}"/>` +
      `<circle cx="22" cy="62" r="20" fill="${c2}"/><circle cx="128" cy="60" r="20" fill="${c2}"/>` +
      `<circle cx="58" cy="34" r="12" fill="${hi}" opacity=".55"/><circle cx="100" cy="30" r="9" fill="${hi}" opacity=".45"/>${dots}`);
    const trunk = svgH("0 0 40 120", 50, // tall enough that its top tucks up inside the crown
      `<path d="M14 120C16 90 15 60 18 30L22 30C25 60 24 90 28 120Z" fill="#6B4A2E"/>` +
      `<path d="M19 70C12 58 8 52 2 46M21 55C28 45 32 40 38 36" stroke="#6B4A2E" stroke-width="4" fill="none" stroke-linecap="round"/>`);
    return `<div class="sc-tree"><div class="sc-trunk">${trunk}</div>${sway(canopy, "", { amp: 1.2, dur: 7, kind: "sc-sway sc-canopy" })}</div>`;
  }

  function sunflower(h) {
    let petals = "";
    for (let i = 0; i < 12; i++) petals += `<ellipse cx="15" cy="10" rx="3" ry="7" fill="${i % 2 ? "#F4C430" : "#F2B520"}" transform="rotate(${i * 30} 15 20)"/>`;
    return svgH("0 0 30 100", h,
      `<path d="M15 100C14 75 16 50 15 22" stroke="#4E7D34" stroke-width="2.6" fill="none"/>` +
      `<path d="M15 70C6 64 3 58 2 54C9 55 13 60 15 66ZM15 52C24 47 27 41 28 37C21 38 17 43 15 49Z" fill="#5A8C3C"/>` +
      `${petals}<circle cx="15" cy="20" r="6.5" fill="#6B4226"/><circle cx="13" cy="18" r="1.2" fill="#8A5A35"/><circle cx="17" cy="21" r="1.2" fill="#8A5A35"/>`);
  }

  function flower(petal, h) {
    const n = pick([5, 6, 8]);
    let p = "";
    for (let i = 0; i < n; i++) p += `<ellipse cx="0" cy="-9" rx="${n === 8 ? 4 : 5.5}" ry="9" fill="${petal}" transform="rotate(${f1((360 / n) * i)})"/>`;
    const head = svgH("-20 -20 40 40", 4.2, `${p}<circle r="5" fill="${petal === "#F7D44C" ? "#E07A2E" : "#F7D44C"}"/>`);
    const stem = svgH("0 0 20 60", h, `<path d="M10 60C9 45 11 30 10 6" stroke="#5E9440" stroke-width="2.2" fill="none"/><path d="M10 40C4 37 2 33 2 30C6 31 9 34 10 38Z" fill="#6AA046"/>`);
    const bd = rand(14, 24);
    return `<div class="sc-flower" style="left:${f1(rand(0, 97))}vw">${stem}` +
      `<div class="sc-bloom" style="--bd:${f1(bd)}s;--bdl:${f1(-rand(0, bd))}s">${head}</div></div>`;
  }

  function pumpkin(h, jack = false) {
    const face = jack
      ? `<g class="sc-glow" fill="#FFD25A"><path d="M19 22L24 15L27 23ZM33 23L36 15L41 22Z"/><path d="M28 27L30 24L32 27Z"/>` +
        `<path d="M17 31Q30 42 43 31L39 32L37 35L34 33L30 37L26 33L23 35L21 32Z"/></g>`
      : "";
    return svgH("0 0 60 46", h,
      `<path d="M28 9C27 5 29 2 33 1L34 3C31 4 30 6 31 9Z" fill="#5B6B2B"/>` +
      `<ellipse cx="13" cy="28" rx="12" ry="15" fill="#B8571D"/><ellipse cx="47" cy="28" rx="12" ry="15" fill="#B8571D"/>` +
      `<ellipse cx="22" cy="28" rx="12" ry="17" fill="#E07A2E"/><ellipse cx="38" cy="28" rx="12" ry="17" fill="#E07A2E"/>` +
      `<ellipse cx="30" cy="28" rx="10" ry="18" fill="#EE9445"/>${face}`);
  }

  function scarecrow() {
    return svgW("-4 0 108 170", 7.4,
      `<rect x="47" y="40" width="6" height="130" fill="#7A5634"/><rect x="6" y="62" width="88" height="5" rx="2" fill="#7A5634"/>` +
      `<path d="M30 58L70 58L76 64L94 62L94 74L72 76L70 112L30 112L28 76L6 74L6 62L24 64Z" fill="#B5532F"/>` +
      `<path d="M40 58V112M60 58V112M29 80H71M30 96H70M14 62V74M86 62V74" stroke="#D9774F" stroke-width="2" opacity=".7"/>` +
      `<rect x="55" y="84" width="9" height="9" fill="#6E8C4A" transform="rotate(8 60 88)"/>` +
      `<path d="M6 63L-1 60M6 68L-2 68M6 73L-1 77M94 63L101 60M94 68L102 68M94 73L101 77M34 112L32 122M40 112L39 124M46 112L46 123M54 112L55 124M60 112L61 122M66 112L68 121" stroke="#E3C16F" stroke-width="2.2" stroke-linecap="round"/>` +
      `<rect x="30" y="106" width="40" height="4" fill="#8C6A3E"/>` +
      `<circle cx="50" cy="42" r="15" fill="#D8BF8C"/><path d="M42 56L58 56L54 60L46 60Z" fill="#8C6A3E"/>` +
      `<path d="M42 37l5 5M47 37l-5 5M53 37l5 5M58 37l-5 5" stroke="#3A2E1E" stroke-width="1.8" stroke-linecap="round"/>` +
      `<path d="M48 44L52 44L50 47Z" fill="#E07A2E"/><path d="M41 49Q50 56 59 49" stroke="#3A2E1E" stroke-width="1.6" fill="none"/>` +
      `<path d="M44 50.5v3M50 52.5v3M56 50.5v3" stroke="#3A2E1E" stroke-width="1.2"/>` +
      `<path d="M36 33l-3 5M40 34l-1 5M60 34l1 5M64 33l3 5" stroke="#E3C16F" stroke-width="2"/>` +
      `<ellipse cx="50" cy="30" rx="24" ry="5" fill="#6B4A2E"/><path d="M38 30Q38 14 50 10Q62 14 62 30Z" fill="#7A5634"/><path d="M38.5 25H61.5V29H38.5Z" fill="#B5532F"/>`);
  }

  function snowman() {
    const dots = [[33, 45], [36.5, 47.6], [40.5, 48.4], [44.5, 47.6], [48, 45]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1"/>`).join("");
    return svgW("0 0 80 150", 8.5,
      `<path d="M20 74L4 60M8 63L3 65M8 63L7 57" stroke="#7A5634" stroke-width="2.6" stroke-linecap="round" fill="none"/>` +
      `<g class="sc-wave"><path d="M60 74L76 58M72 62L78 62M72 62L71 56" stroke="#7A5634" stroke-width="2.6" stroke-linecap="round" fill="none"/></g>` +
      `<g stroke="#C9D4DD" stroke-width="1"><circle cx="40" cy="118" r="30" fill="#EEF2F5"/><circle cx="40" cy="72" r="22" fill="#F2F5F8"/><circle cx="40" cy="38" r="16" fill="#F6F8FA"/></g>` +
      `<g fill="#2E3036"><circle cx="40" cy="66" r="2.2"/><circle cx="40" cy="78" r="2.2"/><circle cx="40" cy="108" r="2.6"/><circle cx="34" cy="34" r="2"/><circle cx="46" cy="34" r="2"/>${dots}</g>` +
      `<path d="M40 38L55 41.5L40 42.5Z" fill="#E8822E"/>` +
      `<path d="M24 52Q40 60 56 52L56 58Q40 66 24 58Z" fill="#C8462B"/>` +
      `<g class="sc-scarf"><path d="M47 58L51 77L44 77L42 59Z" fill="#B23A22"/></g>` +
      `<g stroke="rgba(255,255,255,.18)" stroke-width=".8"><rect x="25" y="20" width="30" height="4" rx="1.5" fill="#3A3D46"/><rect x="30" y="2" width="20" height="19" rx="1.5" fill="#3A3D46"/></g><rect x="30" y="15" width="20" height="4" fill="#C8462B"/>`);
  }

  function pine(w) {
    return svgW("0 0 50 90", w,
      `<rect x="22" y="78" width="6" height="12" fill="#5C3F27"/>` +
      `<path d="M25 2L40 28L32 28L46 52L36 52L50 78L0 78L14 52L4 52L18 28L10 28Z" fill="#336E4C"/>` +
      `<path d="M25 2L31 12Q25 9 19 12ZM10 28h30l-3 3q-6-2-12 1q-6-3-12-1ZM4 52h42l-4 3q-8-2-17 1q-9-3-17-1ZM0 78h50l-3 3q-11-2-22 1q-11-3-22-1Z" fill="#F2F5F8"/>`);
  }

  function lights() {
    const COLORS = ["#E25B4B", "#7CC46B", "#F4D35E", "#5AA6DA", "#F4F1E8"];
    // 10 scallops across the top; the wire's viewBox is 1 unit = 1vw across, 1vh down
    let wire = "M0 0", bulbs = "";
    const n = 10, sag = 3.6, ctrl = sag * 2; // a quadratic's midpoint sits halfway to its control point
    for (let k = 0; k < n; k++) {
      const x0 = k * 10;
      wire += `Q${x0 + 5} ${ctrl} ${x0 + 10} 0`;
      [0.2, 0.5, 0.8].forEach((t, j) => {
        bulbs += `<i class="sc-bulb" style="left:${f1(x0 + t * 10)}vw;top:${f1(2 * t * (1 - t) * ctrl)}vh;--c:${COLORS[(k * 3 + j) % COLORS.length]};--tw:${f1(rand(1.6, 3.4))}s;--tdl:${f1(-rand(0, 3))}s"></i>`;
      });
    }
    return `<svg class="sc-wire" viewBox="0 0 100 8" preserveAspectRatio="none"><path d="${wire}" fill="none" stroke="rgba(20,22,18,.7)" stroke-width=".25" vector-effect="non-scaling-stroke"/></svg>${bulbs}`;
  }

  function cloud(op = 0.14, c = "#F4F1E8") {
    return `<g fill="${c}" opacity="${op}"><circle cx="30" cy="30" r="18"/><circle cx="55" cy="22" r="22"/><circle cx="80" cy="28" r="18"/><circle cx="98" cy="34" r="12"/><rect x="18" y="30" width="86" height="16" rx="8"/></g>`;
  }

  // ================================================================ ambient scenes
  const AMBIENT = {
    summer() {
      let s = `<div class="sc-sun"></div><div class="sc-rays"></div>`;
      for (let i = 0; i < 3; i++) {
        const d = rand(110, 170);
        s += `<div class="sc-cloud" style="top:${f1(rand(2, 16))}vh;--dur:${f1(d)}s;--dl:${f1(-rand(0, d))}s">${svgH("0 0 120 50", rand(7, 11), cloud(0.13))}</div>`;
      }
      s += edgeTree(["#3E6B2B", "#467733", "#4F8238", "#7DB356"]);
      [[0.4, 22], [3.4, 27], [6.2, 19]].forEach(([x, h]) => (s += sway(sunflower(h), `left:${x}vw`, { amp: 2.2, dur: rand(5, 7) })));
      return s + grassStrip(PAL.grassSummer, 6);
    },
    spring() {
      let s = edgeTree(["#4E7D34", "#5A8C3C", "#669A44", "#9CCB6A"], { blossoms: ["#F5B7C8", "#F8D3DE", "#FFFFFF", "#F29BB5"] });
      for (let i = 0; i < 11; i++) s += flower(pick(PAL.petals), rand(4, 7.5));
      s += fallers(10, () => svgH("0 0 10 10", 1.3, `<ellipse cx="5" cy="5" rx="4.5" ry="2.6" fill="${pick(["#F5B7C8", "#F8D3DE", "#F29BB5"])}"/>`), { dur: [16, 26], drift: 4 });
      return s + grassStrip(PAL.grassSpring, 4.5);
    },
    fall() {
      let s = `<div class="sc-moon"></div>`;
      s += edgeTree(["#B5532F", "#C8702B", "#D9952F", "#E8B85A"]);
      // the scarecrow stands in the gap between the first two taps, clear of any Charge CO2 button
      s += sway(scarecrow(), "left:24.5vw", { amp: 1.4, dur: 6.5 });
      s += `<div class="sc-prop" style="left:45vw">${pumpkin(6.2)}${pumpkin(4)}</div>`;
      s += `<div class="sc-prop" style="left:70vw">${pumpkin(4.2)}${pumpkin(6.8, true)}</div>`;
      s += fallers(12, () => leaf(pick(PAL.leaves), rand(2.2, 3.4)), { dur: [12, 20], drift: 4 });
      return s + grassStrip(PAL.grassFall, 4.5);
    },
    winter() {
      let s = `<div class="sc-lights">${lights()}</div>`;
      s += `<div class="sc-prop" style="left:.2vw">${pine(6.5)}</div><div class="sc-prop" style="left:4.6vw">${pine(4.4)}</div>`;
      s += `<div class="sc-prop" style="right:.6vw">${snowman()}</div>`;
      s += fallers(38, () => `<i class="sc-flake" style="--fs:${f1(rand(0.45, 1.25))}vh;opacity:${f1(rand(0.45, 0.95))}"></i>`, { dur: [10, 22], drift: 2.5, spin: false });
      s += `<svg class="sc-snowbank" viewBox="0 0 200 20" preserveAspectRatio="none"><path d="M0 20V9Q12 4 25 8T50 7T75 9T100 6T125 9T150 7T175 9T200 7V20Z" fill="#E9EEF2"/></svg>`;
      return s;
    },
  };

  // ================================================================ surprises
  const actors = () => layer.querySelector(".sc-actors");

  function spawn(html, cls, style, life) {
    const box = actors();
    if (!box) return null;
    const el = document.createElement("div");
    el.className = `sc-actor ${cls}`;
    el.setAttribute("style", style);
    el.innerHTML = html;
    box.appendChild(el);
    setTimeout(() => el.remove(), life * 1000 + 1500);
    return el;
  }

  // walks/flies the art across the screen; `bob` names the inner up-and-down motion
  function cross(art, { y, bottom, dur, rtl = Math.random() < 0.5, bob = "", vars = "" }) {
    const pos = bottom != null ? `bottom:${f1(bottom)}vh` : `top:${f1(y)}vh`;
    const inner = bob ? `<div class="sc-bob ${bob}">${art}</div>` : art;
    return spawn(`<div class="sc-flip">${inner}</div>`, `sc-cross${rtl ? " rtl" : ""}`, `${pos};--dur:${f1(dur)}s;${vars}`, dur);
  }

  function flock(bird, n, h, w = 30) {
    let g = "";
    const mid = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const x = i * (w * 0.8) + rand(-3, 3), y = Math.abs(i - mid) * 7 + rand(-2, 2);
      g += `<g transform="translate(${f1(x)} ${f1(y)}) scale(${rand(0.75, 1.05).toFixed(2)})"><g class="sc-flap" style="animation-delay:${f1(-rand(0, 0.5))}s">${bird}</g></g>`;
    }
    return svgH(`0 0 ${Math.round(n * w * 0.8 + w)} ${Math.round(mid * 7 + 22)}`, h, g);
  }
  const GULL = `<path d="M1 9Q8 1 15 8Q22 1 29 9" fill="none" stroke="#ECE9DD" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  const BAT = `<g fill="#8E7FA8"><ellipse cx="22" cy="11" rx="3.5" ry="5"/><path d="M19.5 7L19 3L21.5 6ZM24.5 7L25 3L22.5 6Z"/>` +
    `<path d="M19 9Q12 2 2 6Q6 8 5 11Q9 10 10 13Q13 11 14 14Q17 11 19 12ZM25 9Q32 2 42 6Q38 8 39 11Q35 10 34 13Q31 11 30 14Q27 11 25 12Z"/></g>` +
    `<circle cx="20.6" cy="10" r=".8" fill="#F4D35E"/><circle cx="23.4" cy="10" r=".8" fill="#F4D35E"/>`;

  function butterfly(c1, c2) {
    return svgH("0 0 40 32", 6,
      `<g class="sc-wing-l"><path d="M20 15C12 1 1 2 3 11C4 16 12 17 20 16Z" fill="${c1}"/><path d="M20 17C12 18 5 22 8 28C11 31 17 25 20 18Z" fill="${c2}"/><circle cx="9" cy="9" r="1.7" fill="#fff" opacity=".8"/></g>` +
      `<g class="sc-wing-r"><path d="M20 15C28 1 39 2 37 11C36 16 28 17 20 16Z" fill="${c1}"/><path d="M20 17C28 18 35 22 32 28C29 31 23 25 20 18Z" fill="${c2}"/><circle cx="31" cy="9" r="1.7" fill="#fff" opacity=".8"/></g>` +
      `<ellipse cx="20" cy="17" rx="1.6" ry="7" fill="#3A2E28"/><path d="M19.5 10Q17 5 15 4M20.5 10Q23 5 25 4" stroke="#3A2E28" stroke-width=".8" fill="none"/>`);
  }

  function duck(fill, h, bob = true) {
    const art = svgH("0 0 50 41", h,
      `<path d="M4 24L0 16L10 21Z" fill="${fill}"/><path d="M4 24Q4 36 22 37Q40 37 42 26Q42 20 34 20L20 22Q10 15 4 24Z" fill="${fill}"/>` +
      `<path d="M14 26Q24 20 32 27Q24 32 14 26Z" fill="rgba(0,0,0,.1)"/><rect x="31" y="14" width="8" height="10" fill="${fill}"/><circle cx="36" cy="12" r="8" fill="${fill}"/>` +
      `<path d="M42 11L50 13L42 15Z" fill="#F29B38"/><circle cx="38.5" cy="10" r="1.4" fill="#222"/><path d="M18 37l-3 3.5h6ZM28 37l-3 3.5h6Z" fill="#F29B38"/>`);
    return bob ? `<div class="sc-waddle" style="--wd:${f1(rand(0.38, 0.5))}s">${art}</div>` : art;
  }

  function reindeer(cx) {
    return `<g><path d="M${cx - 5} 37L${cx - 9} 46" class="sc-leg b" stroke="#7E5534" stroke-width="2.2" stroke-linecap="round"/><path d="M${cx + 5} 37L${cx + 8} 46" class="sc-leg a" stroke="#7E5534" stroke-width="2.2" stroke-linecap="round"/>` +
      `<ellipse cx="${cx}" cy="34" rx="10" ry="5.5" fill="#9A6B43"/><ellipse cx="${cx}" cy="36" rx="6" ry="2.6" fill="#D8B98C"/>` +
      `<path d="M${cx + 6} 31L${cx + 10} 24L${cx + 14} 25L${cx + 11} 34Z" fill="#9A6B43"/><ellipse cx="${cx + 14}" cy="23" rx="4.4" ry="3" fill="#9A6B43"/>` +
      `<circle cx="${cx + 18}" cy="23.4" r="1.2" fill="#2A2420"/><circle cx="${cx + 14.5}" cy="22" r=".7" fill="#2A2420"/>` +
      `<path d="M${cx + 12} 21L${cx + 10} 14M${cx + 10} 17L${cx + 7} 15M${cx + 14} 21L${cx + 15} 14M${cx + 15} 17L${cx + 18} 15" stroke="#E2CFA6" stroke-width="1.2" stroke-linecap="round" fill="none"/></g>`;
  }

  const ghostSVG = (boo) => svgH(`0 0 ${boo ? 92 : 50} 60`, 13,
    `<g class="sc-ghost-body"><path d="M6 28C6 12 15 3 25 3C35 3 44 12 44 28L44 52Q40 58 36 52Q32 46 28 52Q25 58 22 52Q18 46 14 52Q10 58 6 52Z" fill="#F2F1EC"/>` +
    `<path d="M6 34Q0 37 1 30Z M44 34Q50 37 49 30Z" fill="#F2F1EC"/>` +
    `<ellipse cx="18" cy="24" rx="3.2" ry="4.4" fill="#2A2A33"/><ellipse cx="32" cy="24" rx="3.2" ry="4.4" fill="#2A2A33"/><ellipse cx="25" cy="35" rx="3.4" ry="4.4" fill="#2A2A33"/>` +
    `<ellipse cx="12.5" cy="31" rx="3" ry="1.6" fill="#F2A7B3" opacity=".6"/><ellipse cx="37.5" cy="31" rx="3" ry="1.6" fill="#F2A7B3" opacity=".6"/></g>` +
    (boo ? `<g class="sc-boo"><path d="M54 4h32a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H62l-8 7l2-7h-2a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z" fill="#F2F1EC"/>` +
      `<text x="70" y="18.5" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="13" fill="#2A2A33">BOO!</text></g>` : ""));

  const month = () => new Date().getMonth(); // 0 = Jan

  const SURPRISES = {
    summer: {
      birds: { w: 2, run: () => cross(flock(GULL, irand(3, 5), 6.5), { y: rand(3, 14), dur: rand(14, 19), bob: "sc-glide" }) },
      butterfly: { w: 2, run: () => cross(butterfly(pick(["#E8892B", "#6FB7E8", "#F2D54B"]), pick(["#C9651E", "#4C8FC4", "#E2B23A"])), { y: rand(30, 62), dur: rand(15, 20), bob: "sc-flit" }) },
      bee: { w: 1.4, run: () => cross(svgH("0 0 30 22", 4.4,
        `<g class="sc-buzz"><ellipse cx="13" cy="6" rx="6" ry="4.5" fill="#DDEFFF" opacity=".8"/><ellipse cx="18" cy="5" rx="5" ry="4" fill="#DDEFFF" opacity=".8"/></g>` +
        `<ellipse cx="15" cy="14" rx="10" ry="6.5" fill="#F4C430"/><path d="M11 8.1V19.9M15.5 7.5V20.5M20 8.4V19.6" stroke="#3A2E1E" stroke-width="2.4"/>` +
        `<path d="M5 13.4L1.5 14.4L5 15.4Z" fill="#3A2E1E"/><circle cx="24.5" cy="12.5" r="3.6" fill="#3A2E1E"/><circle cx="25.6" cy="11.6" r=".9" fill="#fff"/>`),
        { bottom: rand(5, 12), dur: rand(9, 12), bob: "sc-zig" }) },
      balloon: { w: 1, run: () => {
        const [a, b, c] = pick([["#E05A3A", "#F4C430", "#3E8FC4"], ["#3E8FC4", "#F4F1E8", "#E05A3A"], ["#7CC46B", "#F4C430", "#9A7BD0"]]);
        const art = svgH("0 0 60 92", 16,
          `<path d="M30 2C12 2 3 16 3 31C3 46 16 56 24 66L36 66C44 56 57 46 57 31C57 16 48 2 30 2Z" fill="${a}"/>` +
          `<path d="M30 2C14 6 8 30 17 55L21 60C14 36 18 10 30 2ZM30 2C46 6 52 30 43 55L39 60C46 36 42 10 30 2Z" fill="${b}"/>` +
          `<path d="M30 2C23 10 21 40 26 66L34 66C39 40 37 10 30 2Z" fill="${c}"/><ellipse cx="18" cy="22" rx="5" ry="10" fill="#fff" opacity=".2"/>` +
          `<path d="M24 66L26 78M36 66L34 78" stroke="#6B4A2E" stroke-width="1.2"/><rect x="24" y="77" width="12" height="10" rx="1.5" fill="#8C5E34"/><path d="M24 81H36" stroke="#6B4A2E"/>`);
        const d = rand(28, 36);
        spawn(`<div class="sc-sway" style="--amp:3deg;--sd:4s;--sdl:0s">${art}</div>`, "sc-rise", `left:${f1(rand(8, 60))}vw;--dur:${f1(d)}s;--dx:${f1(rand(10, 30))}vw`, d);
      } },
      banner: { w: 1.3, run: () => {
        const text = pick([app.meta?.bar?.name || "On Tap", "Cold ones on tap", "Cheers!", "Happy hour", "Drink up!"]).toUpperCase();
        const W = Math.max(60, text.length * 8.6 + 18), X = W + 20;
        const art = svgH(`0 0 ${Math.round(W + 92)} 30`, 6,
          `<g class="sc-banner"><rect x="0" y="5" width="${f1(W)}" height="20" rx="2" fill="#F4EFE2"/>` +
          `<text x="${f1(W / 2)}" y="19.6" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="14" letter-spacing="1" fill="#B03C26">${app.esc(text)}</text></g>` +
          `<path d="M${f1(W)} 15H${f1(X)}" stroke="#D8D4C8" stroke-width=".8"/>` +
          `<path d="M${X + 2} 15L${X - 2} 4L${X + 8} 4L${X + 14} 11Z" fill="#B03C26"/>` +
          `<path d="M${X} 15Q${X + 5} 9 ${X + 20} 10L${X + 52} 11Q${X + 64} 13 ${X + 64} 16Q${X + 62} 19 ${X + 50} 19L${X + 18} 19Q${X + 6} 19 ${X} 15Z" fill="#E05A3A"/>` +
          `<path d="M${X + 42} 11.2L${X + 50} 11.6Q${X + 54} 12.6 ${X + 54} 14L${X + 42} 14Z" fill="#BFE3F2"/><ellipse cx="${X + 34}" cy="17" rx="13" ry="3" fill="#B03C26"/>` +
          `<ellipse class="sc-prop-spin" cx="${X + 66}" cy="15" rx="1.4" ry="7" fill="#E6E6E6" opacity=".7"/>`);
        cross(art, { y: rand(2, 8), dur: rand(17, 21), rtl: false, bob: "sc-glide" });
      } },
    },
    spring: {
      bunny: { w: 2, run: () => cross(svgH("0 0 56 44", 7,
        `<circle cx="7" cy="30" r="5" fill="#fff"/><ellipse cx="22" cy="30" rx="15" ry="11" fill="#C9B29A"/><ellipse cx="16" cy="39" rx="8" ry="3.5" fill="#B49A80"/>` +
        `<ellipse cx="33" cy="9" rx="3.2" ry="10" fill="#C9B29A" transform="rotate(-15 33 9)"/><ellipse cx="38" cy="8" rx="3.2" ry="10" fill="#C9B29A" transform="rotate(8 38 8)"/>` +
        `<ellipse cx="38" cy="9" rx="1.4" ry="7" fill="#E9A9B4" transform="rotate(8 38 8)"/><ellipse cx="38" cy="22" rx="9" ry="8" fill="#C9B29A"/>` +
        `<circle cx="41" cy="20" r="1.6" fill="#2A2420"/><circle cx="46.5" cy="23" r="1.3" fill="#E58CA0"/><ellipse cx="33" cy="40" rx="4" ry="2.5" fill="#B49A80"/>`),
        { bottom: 1, dur: rand(10, 13), bob: "sc-hop" }) },
      ducks: { w: 1.5, run: () => {
        const babies = Array.from({ length: irand(3, 4) }, () => duck("#F6D24A", 3.6)).join("");
        cross(`<div class="sc-row">${babies}${duck("#F4F1E8", 6.4)}</div>`, { bottom: 0.8, dur: rand(17, 21) });
      } },
      shower: { w: 1, run: () => {
        let drops = "";
        for (let i = 0; i < 9; i++) drops += `<path class="sc-drop" d="M${18 + i * 8} 40l-1.5 6" stroke="#9CC9E6" stroke-width="2" stroke-linecap="round" style="animation-delay:${f1(-rand(0, 0.8))}s"/>`;
        const d = rand(15, 18);
        cross(svgH("0 0 120 60", 13, `${drops}${cloud(0.85, "#A7B0B8")}`), { y: rand(2, 8), dur: d, bob: "sc-glide" });
        setTimeout(() => spawn(rainbow(), "sc-fade", "--dur:12s;left:calc(50vw - 24vh);top:5vh", 12), d * 450);
      } },
      butterfly: { w: 2, run: () => cross(butterfly(pick(["#F2A7C3", "#B999E0", "#8FC7F0"]), pick(["#F4F1E8", "#F7D44C"])), { y: rand(30, 62), dur: rand(15, 20), bob: "sc-flit" }) },
      hedgehog: { w: 1.2, run: () => cross(svgH("0 0 50 32", 4.6,
        `<path d="M30 14Q46 14 48 24Q47 28 40 28L8 28Q4 28 4 26Z" fill="#D9BE98"/>` +
        `<path d="M4 26L2 18L7 20L6 11L11 15L13 6L17 12L21 4L24 11L29 4L31 12L36 7L36 15L41 13L37 22Q30 18 22 24Z" fill="#7A5A3E"/>` +
        `<circle cx="48" cy="23.5" r="1.8" fill="#2A2420"/><circle cx="41" cy="20" r="1.2" fill="#2A2420"/><path d="M12 28v3M18 28v3M34 28v3M40 28v3" stroke="#5C4430" stroke-width="2.4" stroke-linecap="round"/>`),
        { bottom: 0.8, dur: rand(14, 18), bob: "sc-trot" }) },
      birds: { w: 1, run: () => cross(flock(GULL, irand(2, 4), 6), { y: rand(3, 14), dur: rand(14, 19), bob: "sc-glide" }) },
    },
    fall: {
      ghost: { w: () => (month() === 9 ? 3.5 : 1.5), run: () => {
        const rtl = Math.random() < 0.5;
        cross(ghostSVG(!rtl && Math.random() < 0.6), { y: rand(24, 46), dur: rand(16, 20), rtl, bob: "sc-float" });
      } },
      bats: { w: () => (month() === 9 ? 2.2 : 1), run: () => cross(flock(BAT, irand(3, 4), 7, 44), { y: rand(3, 16), dur: rand(10, 13), bob: "sc-flutter" }) },
      cat: { w: 1.5, run: () => cross(svgH("0 0 72 40", 8,
        `<g fill="#2B2A33" stroke="rgba(230,230,240,.4)" stroke-width=".8">` +
        `<path class="sc-tail" d="M12 20Q2 16 4 6Q5 2 8 4Q6 10 13 16Z"/>` +
        `<rect class="sc-leg a" x="15" y="25" width="3.6" height="13" rx="1.6"/><rect class="sc-leg b" x="21" y="25" width="3.6" height="13" rx="1.6"/>` +
        `<rect class="sc-leg b" x="37" y="25" width="3.6" height="13" rx="1.6"/><rect class="sc-leg a" x="43" y="25" width="3.6" height="13" rx="1.6"/>` +
        `<ellipse cx="30" cy="22" rx="18" ry="8.5"/><path d="M45 11L46 2L51 8ZM53 8L58 1L58.5 10Z"/><circle cx="52" cy="15" r="8"/></g>` +
        `<ellipse cx="53" cy="14" rx="1.5" ry="2" fill="#F4D35E"/><ellipse cx="57.5" cy="14" rx="1.5" ry="2" fill="#F4D35E"/><path d="M58.8 17.5l1.2 1.2l1.2-1.2Z" fill="#E9A9B4"/>`),
        { bottom: 0.6, dur: rand(15, 19) }) },
      gust: { w: 1.4, run: () => {
        let s = "";
        for (let i = 0; i < 16; i++) {
          s += `<div class="sc-gust" style="top:${f1(rand(8, 85))}vh;--dur:${f1(rand(3, 5))}s;animation-delay:${f1(rand(0, 1.6))}s">` +
            `<div class="sc-spin" style="--sp:${f1(rand(0.8, 1.6))}s">${leaf(pick(PAL.leaves), rand(2.2, 3.2))}</div></div>`;
        }
        spawn(s, "sc-burst", "", 8);
      } },
      squirrel: { w: 1.4, run: () => cross(svgH("0 0 56 40", 6,
        `<path d="M15 31C2 31 0 16 6 8C10 3 19 4 19 10C13 10 10 16 15 23Z" fill="#B0703D"/>` +
        `<ellipse cx="26" cy="28" rx="11" ry="8" fill="#B87A45"/><ellipse cx="30" cy="31" rx="6" ry="4.5" fill="#E2C49A"/>` +
        `<circle cx="38" cy="20" r="6.5" fill="#B87A45"/><path d="M35 15L36 9L39 14Z" fill="#B87A45"/><circle cx="40" cy="18.5" r="1.2" fill="#222"/>` +
        `<ellipse cx="46" cy="23" rx="3" ry="3.6" fill="#C08A48"/><path d="M42.6 21.5Q46 18 49.4 21.5Z" fill="#6B4A2E"/>` +
        `<ellipse cx="20" cy="36" rx="5" ry="2.5" fill="#9E6436"/><ellipse cx="33" cy="36" rx="3.5" ry="2.2" fill="#9E6436"/>`),
        { bottom: 0.8, dur: rand(6, 8), bob: "sc-scamper" }) },
    },
    winter: {
      santa: { w: () => (month() === 11 ? 4 : 1), run: () => {
        let sparkles = "";
        for (let i = 0; i < 6; i++) sparkles += `<path class="sc-twinkle" d="M${4 + i * 5} ${20 + (i % 3) * 7}l1 2.4l2.4 1l-2.4 1l-1 2.4l-1-2.4l-2.4-1l2.4-1Z" fill="#F4E3A1" style="animation-delay:${f1(i * 0.15)}s"/>`;
        const art = svgH("0 0 250 60", 11,
          `${sparkles}<path d="M77 34L230 29" stroke="#C9A24A" stroke-width="1"/>` +
          [130, 160, 190, 220].map((x) => reindeer(x)).join("") +
          `<path d="M36 30Q32 14 44 12Q52 14 50 30Z" fill="#8C5E34"/>` +
          `<path d="M50 32Q50 18 60 16Q70 18 70 32Z" fill="#D63B30"/><rect x="50" y="28" width="20" height="4" fill="#F4F1E8"/>` +
          `<circle cx="62" cy="12" r="5.5" fill="#F2C9A5"/><path d="M57 13Q62 22 68 13Q66 17 62 18Q58 17 57 13Z" fill="#F4F1E8"/>` +
          `<path d="M56 10Q62 0 68 9Z" fill="#D63B30"/><circle cx="55" cy="6" r="2" fill="#F4F1E8"/><rect x="56" y="8.5" width="12" height="2.8" rx="1.4" fill="#F4F1E8"/>` +
          `<path d="M66 24L76 28" stroke="#D63B30" stroke-width="4" stroke-linecap="round"/><circle cx="77" cy="28.5" r="2" fill="#2E3036"/><path d="M77 28.5L140 31" stroke="#C9A24A" stroke-width=".8"/>` +
          `<path d="M30 30Q28 46 44 46L82 46Q90 46 92 38L94 28L84 30Q82 38 74 38L44 38Q38 38 38 30Z" fill="#C8302A"/>` +
          `<path d="M38 31Q40 37 44 37L74 37" stroke="#E2B84A" stroke-width="1.5" fill="none"/>` +
          `<path d="M24 52L90 52Q100 52 100 44M40 46L38 52M76 46L78 52" stroke="#E2B84A" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
        cross(art, { y: rand(2, 9), dur: rand(15, 18), bob: "sc-sleigh" });
      } },
      star: { w: 1.4, run: () => {
        const n = Math.random() < 0.35 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          setTimeout(() => spawn(`<div class="sc-streak"></div>`, "sc-shoot", `top:${f1(rand(2, 22))}vh;left:${f1(rand(5, 55))}vw`, 2), i * 900);
        }
      } },
      penguin: { w: 1.5, run: () => cross(svgH("0 0 64 30", 4.8,
        `<g class="sc-spray" fill="#F2F5F8"><circle cx="4" cy="24" r="1.4"/><circle cx="1.5" cy="20" r="1"/><circle cx="6" cy="19" r=".9"/></g>` +
        `<path d="M10 18L3 15L4 21Z" fill="#F29B38"/>` +
        `<ellipse cx="30" cy="18" rx="22" ry="9" fill="#2B2F38" stroke="rgba(230,235,245,.4)" stroke-width=".8"/><ellipse cx="32" cy="22" rx="17" ry="5.5" fill="#F4F7FA"/>` +
        `<path d="M22 12L10 6L16 14Z" fill="#2B2F38"/><circle cx="51" cy="14" r="7" fill="#2B2F38"/><ellipse cx="53" cy="15" rx="4" ry="3.6" fill="#F4F7FA"/>` +
        `<circle cx="54" cy="13.5" r="1.1" fill="#222"/><path d="M57.5 15L63 16.5L57.5 18Z" fill="#F29B38"/>`),
        { bottom: 1.2, dur: rand(6, 8), bob: "sc-slide" }) },
      aurora: { w: 1, run: () => spawn(
        `<div class="sc-band" style="--c:rgba(110,240,180,.30);top:2vh;--ad:9s"></div><div class="sc-band" style="--c:rgba(120,190,255,.22);top:7vh;--ad:11s;animation-delay:-3s"></div>` +
        `<div class="sc-band" style="--c:rgba(190,130,255,.20);top:12vh;--ad:13s;animation-delay:-6s"></div>`, "sc-aurora sc-fade", "--dur:16s", 16) },
      flurry: { w: 1.2, run: () => {
        let s = "";
        for (let i = 0; i < 26; i++) {
          s += `<div class="sc-gust" style="top:${f1(rand(5, 90))}vh;--dur:${f1(rand(2.4, 4))}s;animation-delay:${f1(rand(0, 1.8))}s"><i class="sc-flake" style="--fs:${f1(rand(0.6, 1.3))}vh"></i></div>`;
        }
        spawn(s, "sc-burst", "", 7);
      } },
    },
  };

  function rainbow() {
    const cols = ["#E25B4B", "#F29B38", "#F4D35E", "#7CC46B", "#5AA6DA", "#9A7BD0"];
    const arcs = cols.map((c, i) => { const r = 90 - i * 6; return `<path d="M${100 - r} 100A${r} ${r} 0 0 1 ${100 + r} 100" stroke="${c}" stroke-width="6" fill="none"/>`; }).join("");
    return svgH("0 0 200 100", 24, `<g opacity=".5">${arcs}</g>`);
  }

  // ================================================================ game day (Husker football)
  // Team colors only — no logos. Scarlet & cream at home, black & gold for the visitors.
  const RED = "#D00000", CREAM = "#F5F1E6", GOLD = "#FFCD00";

  // a running player, facing right. Limbs swing via .gd-limb (origins in viewBox units).
  function player({ helmet, stripe, jersey, num, numC, pants, sock, rim = "none", ball = false }) {
    const leg = (hx, kx, ky, ax, ay, cls) =>
      `<g class="gd-limb ${cls}" style="transform-origin:${hx}px 40px"><path d="M${hx} 40L${kx} ${ky}L${ax} ${ay}" stroke="${pants}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M${kx + (ax - kx) * 0.5} ${ky + (ay - ky) * 0.5}L${ax} ${ay}" stroke="${sock}" stroke-width="4.4" stroke-linecap="round"/><path d="M${ax - 2} ${ay + 2.4}h6.5" stroke="#151515" stroke-width="3" stroke-linecap="round"/></g>`;
    const backArm = `<g class="gd-limb a" style="transform-origin:20px 22px"><path d="M20 22L13 30" stroke="${jersey}" stroke-width="4.5" stroke-linecap="round"/></g>`;
    const frontArm = ball
      ? `<path d="M28 22L33 28L29 31" stroke="${jersey}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<ellipse cx="31" cy="28.5" rx="4.6" ry="2.8" fill="#7A4A25" transform="rotate(-20 31 28.5)"/><path d="M29.6 27.9L32.6 26.9" stroke="#fff" stroke-width=".7"/>`
      : `<g class="gd-limb b" style="transform-origin:28px 22px"><path d="M28 22L35 29" stroke="${jersey}" stroke-width="4.5" stroke-linecap="round"/></g>`;
    return `${leg(20, 15, 50, 17, 58, "b")}${backArm}` +
      `<path d="M15 20Q22 15 31 19L30 34Q23 37 18 36Z" fill="${jersey}" stroke="${rim}" stroke-width=".8"/>` +
      `<text x="23.5" y="31" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="9" fill="${numC}">${num}</text>` +
      `<path d="M18 35L30 33L31 41L18 42Z" fill="${pants}"/>${leg(23, 29, 48, 27, 57, "a")}` +
      `<rect x="24" y="16" width="4" height="4" fill="#C98E6A"/><circle cx="27" cy="11" r="7.5" fill="${helmet}" stroke="${rim}" stroke-width=".8"/>` +
      `<path d="M21 6.5Q27 2.5 33 7.5" stroke="${stripe}" stroke-width="2" fill="none"/>` +
      `<path d="M32 11.5H36.5M32 14.5H36M35 9.5V17" stroke="#9AA0A6" stroke-width="1.2" fill="none"/>${frontArm}`;
  }
  const husker = (ball = false) => svgH("0 0 44 64", 12, player({ helmet: CREAM, stripe: RED, jersey: RED, num: pick(["2", "7", "12", "21", "33", "88"]), numC: CREAM, pants: CREAM, sock: RED, ball }));
  const visitor = (ball = false) => svgH("0 0 44 64", 12, player({ helmet: "#151515", stripe: GOLD, jersey: "#151515", num: pick(["4", "9", "15", "44"]), numC: GOLD, pants: GOLD, sock: "#151515", rim: "rgba(255,205,0,.7)", ball }));
  const FOOTBALL = `<ellipse cx="10" cy="6" rx="9" ry="5.4" fill="#7A4A25"/><path d="M5 6H15M7.5 4.6V7.4M10 4.6V7.4M12.5 4.6V7.4" stroke="#fff" stroke-width=".9" fill="none"/>` +
    `<path d="M2.4 3.6Q4 6 2.4 8.4M17.6 3.6Q16 6 17.6 8.4" stroke="#fff" stroke-width=".8" fill="none"/>`;

  // an original mascot: a cheering ear of corn with pom-poms (not the university's character)
  function cornMascot() {
    let kernels = "";
    for (let y = 22; y <= 56; y += 4.4) for (let x = 16.5; x <= 33.5; x += 4.3) {
      if ((y < 25 || y > 52) && (x < 18 || x > 32)) continue;
      kernels += `<circle cx="${f1(x)}" cy="${f1(y)}" r="1.5" fill="rgba(190,130,0,.35)"/>`;
    }
    const pom = (x, y) => `<g fill="${RED}"><circle cx="${x}" cy="${y}" r="4"/><circle cx="${x - 2.6}" cy="${y - 2.4}" r="2.6"/><circle cx="${x + 2.6}" cy="${y - 2}" r="2.6"/></g><circle cx="${x + 0.6}" cy="${y + 1.4}" r="1.8" fill="${CREAM}"/>`;
    return svgH("0 0 50 80", 13,
      `<g class="gd-limb b" style="transform-origin:20px 58px"><path d="M20 58L19 72" stroke="#E8C547" stroke-width="4" stroke-linecap="round"/><ellipse cx="18.5" cy="74" rx="5" ry="2.6" fill="${RED}"/></g>` +
      `<g class="gd-limb a" style="transform-origin:30px 58px"><path d="M30 58L31 72" stroke="#E8C547" stroke-width="4" stroke-linecap="round"/><ellipse cx="32" cy="74" rx="5" ry="2.6" fill="${RED}"/></g>` +
      `<path d="M22 15Q20 5 25 1Q24 8 26.5 15ZM28 15Q32 6 37 7Q31 10 30.5 16Z" fill="#7DB356"/>` +
      `<rect x="12" y="13" width="26" height="47" rx="13" fill="#F4C430"/>${kernels}` +
      `<path d="M13 20Q25 15 37 20L37 24Q25 19 13 24Z" fill="${RED}"/>` +
      `<ellipse cx="20.5" cy="29" rx="3.1" ry="3.7" fill="#fff"/><ellipse cx="29.5" cy="29" rx="3.1" ry="3.7" fill="#fff"/>` +
      `<circle cx="21.3" cy="29.8" r="1.7" fill="#222"/><circle cx="30.3" cy="29.8" r="1.7" fill="#222"/>` +
      `<path d="M19 36Q25 43 31 36Z" fill="#7A2318"/><ellipse cx="16" cy="35" rx="2.2" ry="1.3" fill="#F2A07A" opacity=".7"/><ellipse cx="34" cy="35" rx="2.2" ry="1.3" fill="#F2A07A" opacity=".7"/>` +
      `<path d="M12 44Q4 54 10 66Q14 58 18 52ZM38 44Q46 54 40 66Q36 58 32 52Z" fill="#6AA046"/><path d="M18 50Q25 70 32 50Q25 58 18 50Z" fill="#5E9440"/>` +
      `<g class="gd-pom" style="transform-origin:13px 38px"><path d="M13 38L5 30" stroke="#6AA046" stroke-width="3.4" stroke-linecap="round"/>${pom(4, 27)}</g>` +
      `<g class="gd-pom r" style="transform-origin:37px 38px"><path d="M37 38L45 30" stroke="#6AA046" stroke-width="3.4" stroke-linecap="round"/>${pom(46, 27)}</g>`);
  }

  // the red balloons go up after the first touchdown of the day
  const GD_KEY = "taps.gameday";
  function firstTouchdownToday() {
    const day = new Date().toDateString();
    let seen = false;
    try { seen = localStorage.getItem(GD_KEY) === day; localStorage.setItem(GD_KEY, day); } catch {}
    return !seen;
  }
  // the crowd jumps for a few seconds after a big play
  function gdRoar() {
    layer.classList.add("gd-roar");
    clearTimeout(gdRoar.t);
    gdRoar.t = setTimeout(() => layer.classList.remove("gd-roar"), 4500);
  }

  function gdStands() {
    // rows of fans as dot patterns (cheap: one element per quarter-row), mostly scarlet with some cream
    let rows = "";
    for (let r = 0; r < 11; r++) {
      let segs = "";
      for (let q = 0; q < 4; q++) {
        const b = pick(["#B00000", "#8E0000", RED, "#A31515", "#C22626"]); // a sea of red
        segs += `<i class="gd-seg" style="--b:${b};--cd:${f1(rand(0.5, 1.1))}s;--cdl:${f1(-rand(0, 1))}s;background-position:${f1(rand(0, 1.3))}vh 0,${f1(rand(0, 1.3))}vh .55vh"></i>`;
      }
      rows += `<div class="gd-row">${segs}</div>`;
    }
    return `<div class="gd-stands"><div class="gd-rim"></div>${rows}</div>`;
  }

  // zoomed in on the red zone: the 40 on the left, goal line and end zone on the right.
  // 1 yard = 2vw, so the 40 sits at 6vw and the goal line at 86vw.
  const GOAL_LINE_VW = 86;
  function gdField() {
    let lines = "", nums = "";
    for (let yd = 40; yd >= 0; yd -= 5) {
      const x = GOAL_LINE_VW - yd * 2;
      lines += `<i class="gd-line${yd === 0 ? " goal" : ""}" style="left:${x}vw"></i>`;
      if (yd && yd % 10 === 0) nums += `<span class="gd-num" style="left:${x}vw">${yd}</span><i class="gd-arrow" style="left:${x + 2.9}vw"></i>`;
    }
    return `<div class="gd-field"><div class="gd-hash"></div>${lines}${nums}<div class="gd-endzone"><span>NEBRASKA</span></div></div>` +
      `<div class="gd-goal">${svgH("0 0 40 100", 20, `<path d="M6 0V55H34V0M20 55V100" stroke="${GOLD}" stroke-width="3" fill="none"/>`)}</div>`;
  }

  AMBIENT.gameday = () => gdStands() + gdField();

  function balloons(n = 28) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const d = rand(9, 14);
      s += `<div class="gd-balloon" style="left:${f1(rand(-2, 98))}vw;--dur:${f1(d)}s;animation-delay:${f1(rand(0, 3))}s;--dx:${f1(rand(-8, 8))}vw">` +
        sway(svgH("0 0 20 44", rand(5, 7.5),
          `<ellipse cx="10" cy="11" rx="8.5" ry="10.5" fill="${pick([RED, "#E01A2F", "#C40018"])}"/><ellipse cx="7" cy="6.5" rx="2" ry="3.6" fill="#fff" opacity=".35"/>` +
          `<path d="M8.6 21.6L10 23.6L11.4 21.6Z" fill="#B00000"/><path d="M10 23.6Q7 30 11 35T9 44" stroke="rgba(235,235,235,.6)" stroke-width=".7" fill="none"/>`),
        "position:relative", { amp: 6, dur: rand(2.5, 4) }) + `</div>`;
    }
    spawn(s, "sc-burst", "", 18);
  }

  function fireworks() {
    const bursts = irand(3, 5);
    for (let k = 0; k < bursts; k++) {
      setTimeout(() => {
        const color = pick([RED, CREAM, "#FFFFFF", "#FF3B3B"]);
        let sparks = "";
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2, r = rand(10, 15);
          sparks += `<i class="gd-spark" style="--c:${i % 4 === 0 ? CREAM : color};--dx:${f1(Math.cos(a) * r)}vh;--dy:${f1(Math.sin(a) * r)}vh"></i>`;
        }
        spawn(`<b class="gd-rocket"></b>${sparks}`, "gd-firework", `left:${f1(rand(12, 88))}vw;top:${f1(rand(10, 34))}vh`, 3.2);
      }, k * rand(500, 900));
    }
  }

  SURPRISES.gameday = {
    touchdown: { w: 2, run: () => {
      const d = rand(6.5, 8);
      cross(husker(true), { bottom: 2, dur: d, rtl: false, bob: "gd-stride" });
      // he breaks the plane about 82% of the way across (goal line at 86vw)
      setTimeout(() => {
        gdRoar();
        if (firstTouchdownToday()) setTimeout(() => balloons(), 1200); // tradition: balloons after the first TD
      }, d * 820);
    } },
    fieldgoal: { w: 1.6, run: () => {
      spawn(`<div class="gd-arc"><div class="sc-spin" style="--sp:.5s">${svgH("0 0 20 12", 3.4, FOOTBALL)}</div></div>`, "gd-kick", "bottom:8vh;left:0;--dur:3s", 3);
      setTimeout(gdRoar, 2700);
    } },
    tackle: { w: 1.6, run: () => {
      spawn(`<div class="gd-t-husker">${husker()}</div><div class="gd-t-visitor"><div class="gd-flipx">${visitor(true)}</div></div>` +
        `<div class="gd-pow">${svgH("0 0 40 40", 9, `<path d="M20 2L24 14L37 9L28 20L38 30L25 27L20 39L16 27L3 31L12 20L4 9L16 14Z" fill="${GOLD}"/><path d="M20 9L22.5 16L30 14L25 20L31 26L23.5 24L20 31L17.5 24L10 26L15 20L10 14L17.5 16Z" fill="#fff"/>`)}</div>`,
        "gd-tackle", "bottom:2vh;--dur:7s", 7);
      setTimeout(gdRoar, 3500);
    } },
    mascot: { w: 1.5, run: () => {
      const rtl = Math.random() < 0.5;
      spawn(`<div class="sc-flip"><div class="gd-moves"><div class="sc-waddle" style="--wd:.42s">${cornMascot()}</div></div></div>`,
        `gd-mascot${rtl ? " rtl" : ""}`, "bottom:2vh;--dur:12s", 12);
    } },
    wave: { w: 1.4, run: () => {
      const pass = () => spawn(`<div class="gd-wave"></div>`, "sc-cross gd-wave-run", "bottom:7.5vh;--dur:4.2s", 4.2);
      pass(); setTimeout(pass, 4600);
    } },
    fireworks: { w: 1.2, run: fireworks },
    balloons: { w: 1, run: () => balloons() },
  };

  // ================================================================ volleyball (Husker volleyball)
  // Side view of the court: home side on the left, net at 50vw (between the 2nd and 3rd taps).
  const NAVY = "#1D4E9E";
  const VB_BASE = 2.5; // vh: where players' feet (and the ball's y = 0) sit, on the floor

  // a volleyball player facing right; the hitting arm is .vb-arm so it can swing
  function vbPlayer({ jersey, num, numC, shorts, hair }) {
    const skin = pick(["#E8B990", "#C98E6A", "#8D5A3B", "#F1C8A5"]);
    const leg = (x, cls) =>
      `<g class="vb-leg ${cls}" style="transform-origin:${x}px 41px"><path d="M${x} 41V62" stroke="${skin}" stroke-width="4.6" stroke-linecap="round"/>` +
      `<rect x="${x - 2.7}" y="48.5" width="5.4" height="5" rx="1.6" fill="#F4F4F4"/><path d="M${x - 2} 63.5h6" stroke="#F4F4F4" stroke-width="3.2" stroke-linecap="round"/></g>`;
    return svgH("0 0 40 70", 12,
      `${leg(19, "b")}<path d="M17 21L16 34" stroke="${skin}" stroke-width="3.6" stroke-linecap="round"/>` +
      `<path d="M17 8Q9 11 10 21Q13 15 18 13Z" fill="${hair}"/>` +
      `<path d="M15 18Q22 15 29 18L28 36L16 36Z" fill="${jersey}"/>` +
      `<text x="22" y="30.5" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="9" fill="${numC}">${num}</text>` +
      `<path d="M15.5 35L28.5 35L29 41L15 41Z" fill="${shorts}"/>${leg(25, "a")}` +
      `<rect x="20" y="13" width="4" height="5" fill="${skin}"/><circle cx="22" cy="9" r="6.5" fill="${skin}"/>` +
      `<path d="M15.6 8Q16 2 22 2Q28 2 28.4 7Q24 4.5 15.6 8Z" fill="${hair}"/><circle cx="25.5" cy="8.6" r=".8" fill="#222"/>` +
      `<g class="vb-arm" style="transform-origin:26px 20px"><path d="M26 20L28 33" stroke="${skin}" stroke-width="3.6" stroke-linecap="round"/></g>`);
  }
  const vbHusker = () => vbPlayer({ jersey: RED, num: pick(["1", "4", "10", "13", "25"]), numC: CREAM, shorts: "#1A1A1A", hair: pick(["#3A2A1E", "#C8A05A", "#6B4226", "#1F1A17"]) });
  const vbVisitor = () => vbPlayer({ jersey: NAVY, num: pick(["3", "7", "11", "22"]), numC: "#FFFFFF", shorts: "#FFFFFF", hair: pick(["#3A2A1E", "#C8A05A", "#1F1A17"]) });
  const VBALL = `<circle cx="10" cy="10" r="9.2" fill="#F7F7F2" stroke="#C9C9C0" stroke-width=".6"/>` +
    `<path d="M10 .8Q4 7 6 19M10 .8Q16 7 14 19M1.2 8Q10 12 18.8 8" stroke="#B9B9B0" stroke-width=".9" fill="none"/>` +
    `<path d="M10 .8Q16 7 14 19Q18 15 18.8 8Q16 3 10 .8Z" fill="${RED}" opacity=".85"/>`;

  function vbCourt() {
    // banners for the program's national titles, hanging from the rafters over the header
    const banners = [1995, 2000, 2006, 2015, 2017].map((y, i) =>
      sway(svgH("0 0 30 54", 9.5,
        `<path d="M0 0H30V46L15 54L0 46Z" fill="#B80000"/><path d="M2.5 2.5H27.5V44.5L15 51L2.5 44.5Z" fill="none" stroke="${CREAM}" stroke-width=".9"/>` +
        `<path d="M15 9l1.5 3.4 3.6.3-2.8 2.4.9 3.6L15 16.8l-3.2 1.9.9-3.6-2.8-2.4 3.6-.3Z" fill="${CREAM}"/>` +
        `<text x="15" y="34" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="10" fill="${CREAM}">${y}</text>`),
        `left:${31 + i * 8}vw`, { amp: 1.5, dur: rand(5, 8), kind: "sc-sway vb-banner" })).join("");
    return `<div class="vb-n">N</div>${banners}${gdStands()}` +
      `<div class="vb-court"><i class="vb-line" style="left:8vw"></i><i class="vb-line" style="left:92vw"></i>` +
      `<i class="vb-line dash" style="left:36vw"></i><i class="vb-line dash" style="left:64vw"></i><i class="vb-line" style="left:50vw"></i></div>` +
      `<div class="vb-net">${svgH("0 0 24 100", 17,
        `<rect x="11" y="6" width="2" height="94" fill="#8A8F96"/><rect x="10" y="96" width="4" height="4" fill="#5A5F66"/>` +
        `<rect x="2" y="8" width="20" height="36" fill="rgba(20,20,20,.35)"/>` +
        `<path d="${Array.from({ length: 9 }, (_, i) => `M${2 + i * 2.5} 8V44`).join("")}${Array.from({ length: 9 }, (_, i) => `M2 ${8 + i * 4.5}H22`).join("")}" stroke="rgba(255,255,255,.45)" stroke-width=".5"/>` +
        `<rect x="1" y="6" width="22" height="3" fill="#FFFFFF"/><rect x="1" y="43" width="22" height="1.6" fill="#FFFFFF"/>` +
        `<path d="M3 -8V8" stroke="#FFFFFF" stroke-width="1.4"/><path d="M3 -8V-4M3 0V4" stroke="${RED}" stroke-width="1.4"/>`)}</div>`;
  }
  AMBIENT.volleyball = vbCourt;

  // ball flight through a series of arcs. Points are [x vw, y vh above VB_BASE];
  // `peak` lifts the middle of each leg above the straight line between its ends.
  function arcFrames(start, legs, total) {
    const frames = [{ transform: `translate(${start[0]}vw, ${-start[1]}vh)`, offset: 0 }];
    let t = 0, [x0, y0] = start;
    for (const { to: [x1, y1], peak = 0, dur } of legs) {
      for (let i = 1; i <= 10; i++) {
        const s = i / 10;
        const x = x0 + (x1 - x0) * s, y = y0 + (y1 - y0) * s + 4 * peak * s * (1 - s);
        frames.push({ transform: `translate(${f1(x)}vw, ${f1(-y)}vh)`, offset: Math.min(1, (t + dur * s) / total) });
      }
      t += dur; x0 = x1; y0 = y1;
    }
    return frames;
  }
  const play$ = (el, frames, secs, opts = {}) => el.animate(frames, { duration: secs * 1000, fill: "both", easing: "linear", ...opts });
  const vbBall = (box) => {
    const b = document.createElement("div");
    b.className = "vb-ball";
    b.innerHTML = `<div class="sc-spin" style="--sp:.6s">${svgH("0 0 20 20", 3, VBALL)}</div>`;
    box.appendChild(b);
    return b;
  };
  const bump = (player, secs = 0.35) => play$(player.querySelector(".vb-arm"),
    [{ transform: "rotate(0)" }, { transform: "rotate(-75deg)", offset: 0.4 }, { transform: "rotate(0)" }], secs, { fill: "none" });

  function vbSpike() {
    const T = 4.6;
    const box = spawn(`<div class="vb-p vb-run">${vbHusker()}</div><div class="vb-p"><div class="gd-flipx">${vbVisitor()}</div></div>` +
      `<div class="gd-pow vb-pow">${svgH("0 0 40 40", 8, `<path d="M20 2L24 14L37 9L28 20L38 30L25 27L20 39L16 27L3 31L12 20L4 9L16 14Z" fill="${GOLD}"/><path d="M20 9L22.5 16L30 14L25 20L31 26L23.5 24L20 31L17.5 24L10 26L15 20L10 14L17.5 16Z" fill="#fff"/>`)}</div>`,
      "vb-stage", `bottom:${VB_BASE}vh;--dur:${T}s`, T + 0.5);
    if (!box) return;
    const [hitter, opp] = box.querySelectorAll(".vb-p");
    // approach, jump (contact at ~46%), land, then slip away
    play$(hitter, [
      { transform: "translate(-12vw, 0)", opacity: 1 },
      { transform: "translate(33vw, 0)", offset: 0.32 },
      { transform: "translate(37vw, -13vh)", offset: 0.46, easing: "ease-in" },
      { transform: "translate(39vw, 0)", offset: 0.6 },
      { transform: "translate(39vw, 0)", opacity: 1, offset: 0.86 },
      { transform: "translate(39vw, 0)", opacity: 0 }], T);
    setTimeout(() => hitter.classList.remove("vb-run"), T * 320);
    play$(hitter.querySelector(".vb-arm"), [
      { transform: "rotate(0)" }, { transform: "rotate(0)", offset: 0.36 }, { transform: "rotate(-170deg)", offset: 0.43 },
      { transform: "rotate(-30deg)", offset: 0.48 }, { transform: "rotate(0)", offset: 0.6 }, { transform: "rotate(0)" }], T);
    // the visitor waits at 68vw and gets flattened by the spike
    play$(opp, [
      { transform: "translate(68vw, 0) rotate(0)", opacity: 0 },
      { transform: "translate(68vw, 0) rotate(0)", opacity: 1, offset: 0.12 },
      { transform: "translate(68vw, 0) rotate(0)", offset: 0.53, easing: "ease-out" },
      { transform: "translate(71vw, 1vh) rotate(78deg)", offset: 0.6 },
      { transform: "translate(71vw, 1vh) rotate(78deg)", opacity: 1, offset: 0.88 },
      { transform: "translate(71vw, 1vh) rotate(78deg)", opacity: 0 }], T);
    setTimeout(() => {
      const legs = [
        { to: [41.5, 24], peak: 7, dur: T * 0.16 },   // the set
        { to: [69, 6], dur: T * 0.07 },               // the spike, over the net
        { to: [79, 13], peak: 5, dur: T * 0.1 },      // ricochet off the visitor
        { to: [88, 0], peak: 3, dur: T * 0.1 },
        { to: [106, 0], dur: T * 0.08 },              // and rolls away
      ];
      const total = legs.reduce((t, l) => t + l.dur, 0);
      play$(vbBall(box), arcFrames([46, 3], legs, total), total);
    }, T * 300);
    setTimeout(gdRoar, T * 530);
  }

  function vbRally() {
    const T = 9.5;
    const box = spawn(`<div class="vb-p vb-ready">${vbHusker()}</div><div class="vb-p vb-ready"><div class="gd-flipx">${vbVisitor()}</div></div>`,
      "vb-stage", `bottom:${VB_BASE}vh`, T + 0.5);
    if (!box) return;
    const [home, away] = box.querySelectorAll(".vb-p");
    const show = (el, x) => play$(el, [
      { transform: `translate(${x}vw, 0)`, opacity: 0 }, { transform: `translate(${x}vw, 0)`, opacity: 1, offset: 0.06 },
      { transform: `translate(${x}vw, 0)`, opacity: 1, offset: 0.9 }, { transform: `translate(${x}vw, 0)`, opacity: 0 }], T);
    show(home, 29); show(away, 66);
    const H = [33.5, 7], A = [66, 7], leg = 1.35;
    const legs = [{ to: A, peak: 26, dur: leg }, { to: H, peak: 26, dur: leg }, { to: A, peak: 24, dur: leg }, { to: H, peak: 26, dur: leg },
      { to: [77, 0], peak: 12, dur: 0.95 }, { to: [86, 5], peak: 2, dur: 0.45 }, { to: [94, 0], peak: 2, dur: 0.45 }];
    const total = legs.reduce((t, l) => t + l.dur, 0), start = 0.8;
    setTimeout(() => {
      play$(vbBall(box), arcFrames(H, legs, total), total);
      // each player bumps as the ball reaches them; the last Husker hit finds the floor
      [0, 2, 4].forEach((k) => setTimeout(() => bump(home), k * leg * 1000));
      [1, 3].forEach((k) => setTimeout(() => bump(away), k * leg * 1000));
      setTimeout(gdRoar, (4 * leg + 0.95) * 1000);
    }, start * 1000);
  }

  function vbSigns() {
    const signs = ["G", "B", "R"].map((ch, i) =>
      `<div class="vb-sign" style="left:${25 + i * 25}vw;animation-delay:${f1(i * 0.8)}s"><div class="vb-card">${ch}</div><i class="vb-hand l"></i><i class="vb-hand r"></i></div>`).join("");
    spawn(signs, "sc-burst", "", 9);
    setTimeout(gdRoar, 2400);
  }

  function vbConfetti() {
    let s = "";
    for (let i = 0; i < 70; i++) {
      s += `<i class="vb-confetti" style="left:${f1(rand(0, 100))}vw;--c:${pick([RED, CREAM, "#FFFFFF", "#9E0000"])};--dur:${f1(rand(5, 8.5))}s;` +
        `animation-delay:${f1(rand(0, 1.8))}s;--dx:${f1(rand(-6, 6))}vw;--fl:${f1(rand(0.6, 1.4))}s"><b></b></i>`;
    }
    spawn(s, "sc-burst", "", 11);
    gdRoar();
  }

  function vbLightShow() {
    let s = "";
    for (let i = 0; i < 60; i++) {
      s += `<i class="vb-phone" style="left:${f1(rand(1, 99))}%;bottom:${f1(rand(5, 88))}%;--sd:${f1(rand(1.2, 2.4))}s;--sdl:${f1(-rand(0, 2))}s"></i>`;
    }
    spawn(`<div class="vb-dark"></div>${s}`, "vb-lights sc-fade", "--dur:10s", 10);
  }

  SURPRISES.volleyball = {
    signs: { w: 2, run: vbSigns },
    spike: { w: 2, run: vbSpike },
    rally: { w: 2, run: vbRally },
    confetti: { w: 1, run: vbConfetti },
    lights: { w: 1, run: vbLightShow },
    wave: SURPRISES.gameday.wave,
    mascot: SURPRISES.gameday.mascot,
  };

  // ================================================================ traitors (murder-mystery wine party)
  // A candlelit banquet in black, burgundy and old gold. One seated guest has red eyes.
  // The board's own colors switch too: see :root[data-scene="traitors"] in scenery.css.
  const WINE = "#7A1528", WINE_HI = "#A8243C", GILT = "#C9A45C", PARCH = "#EADFC6", SHADOW = "#0E080A", CLOTH = "#170C10";
  const RIM = "rgba(200,80,100,.75)"; // a thin edge so black cloaks still read in a black room
  const TR_GAPS = [25, 50, 75];       // vw: the open wall between the four taps
  const TR_STAR = `<path d="M20 2L24 14L37 9L28 20L38 30L25 27L20 39L16 27L3 31L12 20L4 9L16 14Z" fill="${GILT}"/><path d="M20 9L22.5 16L30 14L25 20L31 26L23.5 24L20 31L17.5 24L10 26L15 20L10 14L17.5 16Z" fill="${WINE_HI}"/>`;

  const trFlame = (x, y) => {
    const d = rand(0.9, 1.6);
    return `<i class="tr-flame" style="left:${f1(x)}%;bottom:${f1(y)}%;--fd:${f1(d)}s;--fdl:${f1(-rand(0, d))}s"><b></b></i>`;
  };
  const gobletArt = (wine = WINE) =>
    `<path d="M3 3Q3 20 12 22Q21 20 21 3Z" fill="rgba(235,225,225,.13)" stroke="rgba(235,225,225,.65)" stroke-width=".8"/>` +
    `<path d="M3.6 9Q3.8 20 12 21.4Q20.2 20 20.4 9Z" fill="${wine}"/><path d="M6 6Q6 13 8 16" stroke="rgba(255,255,255,.4)" stroke-width=".8" fill="none"/>` +
    `<path d="M12 22V35" stroke="rgba(235,225,225,.7)" stroke-width="1.5"/><path d="M5 38Q12 33 19 38Z" fill="rgba(235,225,225,.7)"/>`;
  const trGoblet = (h, wine) => svgH("0 0 24 40", h, gobletArt(wine));
  const trBottle = (h) => svgH("0 0 20 60", h,
    `<path d="M7 1H13V16Q18 20 18 27V57Q18 59 16 59H4Q2 59 2 57V27Q2 20 7 16Z" fill="#160C10" stroke="${RIM}" stroke-width=".7"/>` +
    `<rect x="6.6" y="1" width="6.8" height="9" fill="${WINE}"/><rect x="3.4" y="32" width="13.2" height="16" fill="${PARCH}"/><path d="M6 37H14M6 41H14" stroke="${WINE}" stroke-width="1"/>`);

  function trCandelabra(left) {
    const flames = [[10, 16], [30, 7], [50, 16]].map(([x, y]) => trFlame((x / 60) * 100, ((90 - y) / 90) * 100)).join("");
    const art = svgH("0 0 60 90", 19,
      `<path d="M30 84V30M10 36Q10 54 30 54Q50 54 50 36" stroke="${GILT}" stroke-width="2.4" fill="none"/><path d="M19 90Q21 81 30 81Q39 81 41 90Z" fill="${GILT}"/>` +
      `<path d="M5 36H15L13 39H7ZM25 28H35L33 31H27ZM45 36H55L53 39H47Z" fill="${GILT}"/>` +
      `<path d="M7.5 18H12.5V36H7.5ZM27.5 9H32.5V28H27.5ZM47.5 18H52.5V36H47.5Z" fill="${PARCH}"/>`);
    return `<div class="tr-stand" style="left:${left}vw">${art}${flames}</div>`;
  }

  function trChandelier() {
    const xs = [14, 32, 50, 68, 86];
    const flames = xs.map((x) => trFlame(x, ((70 - 30) / 70) * 100)).join("");
    return `<div class="tr-chandelier">${svgH("0 0 100 70", 20,
      `<path d="M50 0V40" stroke="${GILT}" stroke-width="1.4"/><path d="M14 44Q32 62 50 56Q68 62 86 44M32 44Q40 54 50 56Q60 54 68 44M50 40V62" stroke="${GILT}" stroke-width="2" fill="none"/>` +
      `<circle cx="50" cy="40" r="3.4" fill="${GILT}"/><path d="M47 62H53L50 69Z" fill="${WINE_HI}"/>` +
      xs.map((x) => `<path d="M${x - 5} 44H${x + 5}L${x + 3} 47H${x - 3}Z" fill="${GILT}"/><rect x="${x - 2}" y="31" width="4" height="13" fill="${PARCH}"/>`).join(""))}${flames}</div>`;
  }

  // a gilt-framed ancestor whose eyes slide around the room
  function trPortrait(left, hooded) {
    const sitter = hooded
      ? `<path d="M25 13C14 13 11 25 12 36Q8 44 7 54H43Q42 44 38 36Q39 25 25 13Z" fill="#120A0D"/><path d="M25 22C19 22 17 29 19 35Q25 39 31 35Q33 29 25 22Z" fill="#020102"/>`
      : `<path d="M8 54Q10 40 25 38Q40 40 42 54Z" fill="${WINE}"/><circle cx="25" cy="27" r="10" fill="#B99279"/><path d="M15 26Q15 15 25 15Q35 15 35 26Q30 20 25 21Q20 20 15 26Z" fill="#20130F"/>`;
    const eyeY = hooded ? 29 : 27;
    const eyes = hooded
      ? `<g class="tr-shifty" fill="#FF4B3E"><circle cx="22" cy="${eyeY}" r="1.2"/><circle cx="28" cy="${eyeY}" r="1.2"/></g>`
      : `<ellipse cx="21" cy="${eyeY}" rx="2.2" ry="1.5" fill="#EFE7DA"/><ellipse cx="29" cy="${eyeY}" rx="2.2" ry="1.5" fill="#EFE7DA"/><g class="tr-shifty" fill="#111"><circle cx="21" cy="${eyeY}" r="1"/><circle cx="29" cy="${eyeY}" r="1"/></g>`;
    return `<div class="tr-portrait" style="left:${left}vw">${svgH("0 0 50 64", 19,
      `<rect x="1" y="1" width="48" height="62" rx="2" fill="#7E6232" stroke="${GILT}" stroke-width="2"/><rect x="6" y="6" width="38" height="52" fill="#1B1012" stroke="#3B2A16"/>` +
      `<svg x="6" y="6" width="38" height="52" viewBox="6 6 38 52">${sitter}${eyes}</svg>`)}</div>`;
  }

  function trSeated(left, traitor) {
    const who = traitor
      ? `<path d="M30 16C20 16 17 26 19 36Q12 44 11 70H49Q48 44 41 36Q43 26 30 16Z" fill="#050304" stroke="${RIM}" stroke-width=".6"/><path d="M30 24C25 24 23 30 25 35Q30 38 35 35Q37 30 30 24Z" fill="#000"/>` +
        `<g class="tr-blink" fill="#FF4B3E"><circle cx="27.5" cy="30.5" r="1.1"/><circle cx="32.5" cy="30.5" r="1.1"/></g>`
      : `<path d="M13 70Q15 44 30 42Q45 44 47 70Z" fill="#070405"/><circle cx="30" cy="30" r="9.5" fill="#070405"/>`;
    return `<div class="tr-seat" style="left:${f1(left)}vw">${svgH("0 0 60 70", 17,
      `<path d="M8 70V20Q8 5 30 2Q52 5 52 20V70Z" fill="#240E15" stroke="rgba(201,164,92,.4)" stroke-width="1"/><path d="M14 70V23Q14 11 30 8Q46 11 46 23V70" fill="#32121C"/>${who}`)}</div>`;
  }

  function trRoom() {
    const valance = `<svg class="tr-valance" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="M0 0H100V5${Array.from({ length: 10 }, (_, i) => `Q${95 - i * 10} 11 ${90 - i * 10} 5`).join("")}Z" fill="${WINE}"/>` +
      `<path d="M100 5${Array.from({ length: 10 }, (_, i) => `Q${95 - i * 10} 11 ${90 - i * 10} 5`).join("")}" fill="none" stroke="${GILT}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
    const traitorSeat = pick([1, 3, 5, 7]);
    let seats = "";
    for (let i = 0; i < 9; i++) seats += trSeated(1 + i * 11.2, i === traitorSeat);
    let places = "";
    [4.5, 19.8, 30.5, 44.2, 55.8, 69.5, 80.5, 95.5].forEach((x, i) => { // kept clear of the text under each keg
      places += `<div class="tr-place" style="left:${x}vw">${i % 3 === 1 ? trBottle(10) : ""}${trGoblet(6)}</div>`;
    });
    return `<div class="tr-wall"></div>${valance}${trPortrait(25, false)}${trPortrait(75, true)}${trChandelier()}${seats}` +
      `<div class="tr-table"></div>${places}${TR_GAPS.map(trCandelabra).join("")}`;
  }
  AMBIENT.traitors = trRoom;

  // the cloaked figure, facing right. .tr-arm swings from the shoulder.
  function trCloak({ dagger = false, h = 22 } = {}) {
    const blade = dagger ? `<path d="M54.5 58V38L56 33L57.5 38V58Z" fill="#DDE1E6"/><rect x="51" y="57" width="10" height="2" fill="${GILT}"/>` : "";
    return svgH("0 0 64 104", h,
      `<path d="M24 97h7l3 3H24ZM38 97h7l3 3H38Z" fill="#050304"/>` +
      `<path class="tr-hem" d="M22 34Q10 64 6 96Q13 91 19 97Q26 91 32 98Q39 92 45 97Q51 92 56 95Q52 62 43 34Z" fill="${SHADOW}" stroke="${RIM}"/>` +
      `<path d="M24 46Q20 70 17 90M33 48Q33 72 32 92M41 46Q44 70 46 90" stroke="rgba(150,50,70,.5)" fill="none"/>` +
      `<path d="M32 2C18 2 13 16 15 30Q16 40 23 46L43 42Q49 30 46 17Q42 4 32 2Z" fill="${CLOTH}" stroke="${RIM}"/>` +
      `<path d="M35 13C28 14 26 23 28 30Q34 36 43 30Q46 21 42 15Q39 12 35 13Z" fill="#020102"/>` +
      `<g class="tr-blink" fill="#FF4B3E"><ellipse cx="34" cy="23" rx="1.9" ry="1.2"/><ellipse cx="40.5" cy="23" rx="1.7" ry="1.2"/></g>` +
      `<g class="tr-arm" style="transform-origin:38px 50px">${blade}<path d="M38 48Q50 52 56 58L52 64Q42 62 34 56Z" fill="${CLOTH}" stroke="${RIM}"/><circle cx="55.5" cy="60" r="3" fill="#D8B59A"/></g>`);
  }

  // a dinner guest in their finest, facing right, wine in hand
  function trGuest() {
    const skin = pick(["#E8B990", "#C98E6A", "#8D5A3B", "#F1C8A5"]), hair = pick(["#3A2A1E", "#C8A05A", "#6B4226", "#1F1A17"]);
    const outfit = Math.random() < 0.5
      ? `<path d="M15 24Q22 20 29 24L30 44L38 81H6L14 44Z" fill="${WINE_HI}"/><path d="M14 44H30" stroke="${GILT}" stroke-width="1.2"/>`
      : `<path d="M16 48L15 80M28 48L29 80" stroke="#15151A" stroke-width="6" stroke-linecap="round"/><path d="M15 24Q22 20 29 24L31 50H13Z" fill="#23232B"/><path d="M19 23L22 34L25 23Z" fill="#F4F1E8"/><path d="M20.4 23.4H23.6L22 26Z" fill="${WINE_HI}"/>`;
    return svgH("0 0 48 84", 20,
      `${outfit}<rect x="19.5" y="17" width="5" height="6" fill="${skin}"/><circle cx="22" cy="11" r="8" fill="${skin}"/><path d="M14 11Q14 2 22 2Q30 2 30 9Q24 5 18 8Q16 12 16 16Q14 14 14 11Z" fill="${hair}"/>` +
      `<g class="tr-alive"><circle cx="26.5" cy="10.5" r="1" fill="#222"/><path d="M25 15Q27 16 29 14.6" stroke="#6B2A22" fill="none"/></g>` +
      `<g class="tr-dead" stroke="#222" stroke-width="1"><path d="M24.6 9l3 3M27.6 9l-3 3"/><path d="M25 15.6h4"/></g>` +
      `<g class="tr-sip" style="transform-origin:27px 27px"><path d="M27 27L36 34" stroke="${skin}" stroke-width="3.6" stroke-linecap="round"/><g transform="translate(31 16) scale(.62)">${gobletArt()}</g></g>`);
  }

  const appear = (el, T, a, b, c = 0.92) => play$(el, [
    { opacity: 0, offset: 0 }, { opacity: 0, offset: a }, { opacity: 1, offset: b }, { opacity: 1, offset: c }, { opacity: 0, offset: 1 }], T);

  // tiptoes along the table, freezing to check over a shoulder
  function trSneak() {
    const T = 17, rtl = Math.random() < 0.5;
    const at = (x) => `translateX(${f1(rtl ? 86 - x : x)}vw)`;
    const box = spawn(`<div class="tr-p tr-tiptoe"><div style="transform:scaleX(${rtl ? -1 : 1})"><div class="tr-look">${trCloak()}</div></div></div>`, "tr-floor", "", T);
    if (!box) return;
    const stops = [[-18, 0], [18, 0.2], [18, 0.3], [44, 0.47], [44, 0.57], [70, 0.73], [70, 0.81], [114, 1]];
    play$(box.querySelector(".tr-p"), stops.map(([x, offset]) => ({ transform: at(x), offset })), T);
    const looks = [[1, 0], [1, 0.22], [-1, 0.24], [-1, 0.27], [1, 0.29], [1, 0.49], [-1, 0.51], [-1, 0.54], [1, 0.56], [1, 0.75], [-1, 0.77], [-1, 0.79], [1, 0.81], [1, 1]];
    play$(box.querySelector(".tr-look"), looks.map(([s, offset]) => ({ transform: `scaleX(${s})`, offset })), T);
  }

  const TR_CLUES = [
    `<g fill="none" stroke="${PARCH}" stroke-width="1.5" stroke-linecap="round"><path d="M9 28Q7 8 20 7Q33 8 31 28"/><path d="M13 31Q11 12 20 12Q29 12 27 30"/><path d="M17 33Q15 17 20 17Q25 17 23 32"/><path d="M20 22V33"/></g>`,
    `<path d="M19 3L22 7V25H18V7Z" fill="#DDE1E6"/><rect x="13" y="25" width="14" height="2.6" fill="${GILT}"/><rect x="18" y="27" width="4" height="9" fill="${WINE_HI}"/>`,
    `<g fill="none" stroke="${GILT}" stroke-width="2.4"><circle cx="20" cy="10" r="6"/><path d="M20 16V35M20 28h6M20 33h5"/></g>`,
    `<path d="M16 4H24V8L23 10V14Q31 19 31 27Q31 36 20 36Q9 36 9 27Q9 19 17 14V10L16 8Z" fill="rgba(235,225,225,.2)" stroke="${PARCH}"/><path d="M10 25Q20 21 30 25Q31 35 20 35Q9 35 10 25Z" fill="#5EE26A"/>`,
  ];

  // an antique brass loupe with a turned mahogany handle. Rim and handle are drawn upright
  // around the lens's center and rotated as one piece, so the handle always runs straight out of it.
  const TR_LENS_CENTER = 8.4; // vh from the art's top-left corner to the center of the glass
  function trLoupe() {
    const stops = (list) => list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");
    const defs = `<defs>` +
      `<linearGradient id="trBrass" x1="0" y1="0" x2="1" y2="1">${stops([[0, "#FBEDBE"], [0.3, "#D4AE63"], [0.55, "#7C5A25"], [0.75, "#E3C27A"], [1, "#5A3F18"]])}</linearGradient>` +
      `<linearGradient id="trBrassBar">${stops([[0, "#5A3F18"], [0.3, "#F3DFA6"], [0.6, "#B98F45"], [1, "#4A3313"]])}</linearGradient>` +
      `<linearGradient id="trWood">${stops([[0, "#210D07"], [0.3, "#7A3620"], [0.48, "#9A4F2E"], [0.75, "#4A1D10"], [1, "#180905"]])}</linearGradient>` +
      `<radialGradient id="trGlass" cx=".42" cy=".38" r=".68"><stop offset="0" stop-color="#FFF8E1" stop-opacity=".05"/><stop offset=".7" stop-color="#C8D7E1" stop-opacity=".09"/><stop offset="1" stop-color="#0F141E" stop-opacity=".55"/></radialGradient>` +
      `</defs>`;
    const handle =
      `<path d="M-7 58H7L9 71H-9Z" fill="url(#trBrassBar)"/><rect x="-12" y="71" width="24" height="6" rx="2" fill="url(#trBrassBar)"/><rect x="-10" y="77" width="20" height="3" fill="#3A280F"/>` +
      `<path d="M-9 80C-14 90 -14 100 -10 108C-8 114 -8 118 -10 124C-14 136 -13 146 -9 152H9C13 146 14 136 10 124C8 118 8 114 10 108C14 100 14 90 9 80Z" fill="url(#trWood)"/>` +
      `<rect x="-9.5" y="112" width="19" height="4.5" rx="1.2" fill="url(#trBrassBar)"/>` +
      `<path d="M-6 86C-9 94 -9 100 -6.5 106M-6.5 124C-9 132 -9 140 -6 147" stroke="rgba(255,225,190,.35)" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
      `<path d="M-10 152H10L8 159Q0 165 -8 159Z" fill="url(#trBrassBar)"/><circle cy="165" r="3.4" fill="url(#trBrassBar)"/>`;
    const rim =
      `<circle r="62" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="4"/><circle r="50" fill="url(#trGlass)"/>` +
      `<circle r="56" fill="none" stroke="url(#trBrass)" stroke-width="11"/><circle r="61.2" fill="none" stroke="#3F2B10" stroke-width="1.2"/><circle r="50.6" fill="none" stroke="#2E1F0B" stroke-width="1.6"/>` +
      `<circle r="56" fill="none" stroke="#FCEFC6" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0 5.864" opacity=".85"/>`;
    // the glare stays out of the rotation so the light keeps coming from the upper left
    const glare = `<path d="M-41 -10A42 42 0 0 1 -10 -41A54 54 0 0 0 -41 -10Z" fill="rgba(255,255,255,.62)"/><circle cx="-43" cy="3" r="2.4" fill="rgba(255,255,255,.55)"/>` +
      `<path d="M37 21A42 42 0 0 1 21 37" stroke="rgba(255,255,255,.24)" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;
    return svgH("0 0 200 210", 25.2, `${defs}<g transform="translate(70 70) rotate(-40)">${handle}${rim}</g><g transform="translate(70 70)">${glare}</g>`);
  }

  // a magnifying glass drifts room to room, turning up a clue at each stop
  function trMagnifier() {
    const T = 15;
    const spots = TR_GAPS.map((x) => [x, rand(52, 60)]); // below the portraits, above the candles
    const clues = [...TR_CLUES].sort(() => Math.random() - 0.5).slice(0, 3);
    const clueHTML = spots.map(([x, y], i) => `<div class="tr-clue" style="left:${f1(x)}vw;top:${f1(y)}vh">${svgH("0 0 40 40", 8, clues[i])}</div>`).join("");
    const box = spawn(`${clueHTML}<div class="tr-lens"><i class="tr-lens-glow"></i><div class="tr-scan">${trLoupe()}</div></div>`, "sc-burst", "", T);
    if (!box) return;
    // the center of the glass lands on each clue
    const pos = (x, y) => `translate(calc(${f1(x)}vw - ${TR_LENS_CENTER}vh), calc(${f1(y)}vh - ${TR_LENS_CENTER}vh))`;
    const beats = [[0.2, 0.33], [0.45, 0.58], [0.7, 0.84]];
    const frames = [{ transform: pos(-14, 24), offset: 0 }];
    spots.forEach(([x, y], i) => frames.push({ transform: pos(x, y), offset: beats[i][0], easing: "ease-in-out" }, { transform: pos(x, y), offset: beats[i][1], easing: "ease-in-out" }));
    frames.push({ transform: pos(116, 20), offset: 1 });
    play$(box.querySelector(".tr-lens"), frames, T);
    box.querySelectorAll(".tr-clue").forEach((c, i) => appear(c, T, beats[i][0] - 0.02, beats[i][0] + 0.03, beats[i][1] + 0.04));
  }

  // the main event: a guest enjoys their wine, the traitor creeps up, and only a chalk outline is left
  function trMurder() {
    const T = 14, x = pick(TR_GAPS) - 4;
    const chalk = svgH("0 0 92 36", 8,
      `<path d="M4 18C4 12 11 9 16 12C18 14 19 15 22 15L34 11L42 5L46 8L40 15L52 14L70 8L84 3L87 7L72 15L88 20L86 25L70 21L54 24L40 27L47 33L42 35L33 28L22 23C17 25 4 26 4 18Z" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.5" stroke-dasharray="3 1.6"/>`);
    const box = spawn(
      `<div class="tr-chalk" style="left:${f1(x)}vw">${chalk}</div><div class="tr-spill" style="left:calc(${f1(x)}vw + 15vh)"></div>` +
      `<div class="tr-p tr-victim">${trGuest()}</div><div class="tr-p tr-killer"><div class="tr-look">${trCloak({ dagger: true })}</div></div>` +
      `<div class="tr-pow" style="left:calc(${f1(x)}vw + 2vh);animation-delay:${f1(T * 0.39)}s">${svgH("0 0 40 40", 11, TR_STAR)}</div>` +
      `<div class="tr-p tr-spirit">${ghostSVG(false)}</div>`,
      "tr-floor", "", T);
    if (!box) return;
    const [victim, killer, spirit] = [".tr-victim", ".tr-killer", ".tr-spirit"].map((s) => box.querySelector(s));
    const gx = `translateX(${f1(x)}vw)`, kx = (v) => `translateX(${f1(v)}vw)`;
    play$(victim, [
      { transform: `${gx} rotate(0)`, opacity: 0, offset: 0 }, { transform: `${gx} rotate(0)`, opacity: 1, offset: 0.05 },
      { transform: `${gx} rotate(0)`, offset: 0.39, easing: "ease-in" }, { transform: `${gx} rotate(84deg)`, offset: 0.45 },
      { transform: `${gx} rotate(84deg)`, opacity: 1, offset: 0.62 }, { transform: `${gx} rotate(84deg)`, opacity: 0, offset: 0.68 },
      { transform: `${gx} rotate(84deg)`, opacity: 0, offset: 1 }], T);
    play$(killer, [
      { transform: kx(-18), offset: 0 }, { transform: kx(x - 9), offset: 0.3 }, { transform: kx(x - 9), offset: 0.6 }, { transform: kx(-20), offset: 0.8 }, { transform: kx(-20), offset: 1 }], T);
    play$(killer.querySelector(".tr-look"), [
      { transform: "scaleX(1)", offset: 0 }, { transform: "scaleX(1)", offset: 0.58 }, { transform: "scaleX(-1)", offset: 0.6 }, { transform: "scaleX(-1)", offset: 1 }], T);
    play$(killer.querySelector(".tr-arm"), [
      { transform: "rotate(0)", offset: 0 }, { transform: "rotate(0)", offset: 0.31 }, { transform: "rotate(-125deg)", offset: 0.36 }, { transform: "rotate(-125deg)", offset: 0.385 },
      { transform: "rotate(25deg)", offset: 0.4 }, { transform: "rotate(0)", offset: 0.48 }, { transform: "rotate(0)", offset: 1 }], T);
    setTimeout(() => victim.classList.add("tr-fallen"), T * 400);
    appear(box.querySelector(".tr-chalk"), T, 0.5, 0.58);
    appear(box.querySelector(".tr-spill"), T, 0.43, 0.47);
    play$(spirit, [
      { transform: `translate(calc(${f1(x)}vw + 6vh), 0)`, opacity: 0, offset: 0 }, { transform: `translate(calc(${f1(x)}vw + 6vh), 0)`, opacity: 0, offset: 0.62 },
      { transform: `translate(calc(${f1(x)}vw + 7vh), -14vh)`, opacity: 0.85, offset: 0.76 }, { transform: `translate(calc(${f1(x)}vw + 5vh), -40vh)`, opacity: 0, offset: 0.98 },
      { transform: `translate(calc(${f1(x)}vw + 5vh), -40vh)`, opacity: 0, offset: 1 }], T);
  }

  // a gloved hand slips something into someone's glass
  function trPoison() {
    const T = 11, x = pick(TR_GAPS) + pick([-6, 6]);
    const drops = [0, 1, 2].map((i) => `<i class="tr-drop" style="animation-delay:${f1(T * 0.28 + i * 0.45)}s"></i>`).join("");
    const fizz = Array.from({ length: 6 }, (_, i) => `<i class="tr-fizz" style="left:${f1(rand(28, 68))}%;animation-delay:${f1(T * 0.42 + i * 0.28)}s"></i>`).join("");
    const skull = svgH("0 0 24 26", 5.5,
      `<path d="M12 1C5 1 2 6 2 11C2 15 4 17 6 18V23H18V18C20 17 22 15 22 11C22 6 19 1 12 1Z" fill="#CFF7C9"/><circle cx="8" cy="11" r="2.8" fill="#102414"/><circle cx="16" cy="11" r="2.8" fill="#102414"/>` +
      `<path d="M12 14L10.5 17H13.5Z" fill="#102414"/><path d="M9 19V23M12 19V23M15 19V23" stroke="#102414"/>`);
    const hand = svgH("0 0 40 60", 15,
      `<rect x="12" y="-300" width="16" height="326" fill="${CLOTH}" stroke="${RIM}"/><path d="M10 24H30V29H10Z" fill="${WINE}"/>` +
      `<path d="M13 29H27L29 40Q24 45 16 43L11 38Z" fill="#17171B" stroke="rgba(235,225,225,.3)"/>` +
      `<g transform="rotate(32 21 44)"><rect x="17" y="38" width="8" height="17" rx="2" fill="rgba(160,255,170,.3)" stroke="#CFF7C9"/><rect x="17.6" y="46" width="6.8" height="8.5" fill="#5EE26A"/><rect x="18.6" y="34.5" width="4.8" height="4" fill="#7A5634"/></g>`);
    const box = spawn(
      `<div class="tr-cup">${trGoblet(15)}<div class="tr-taint">${trGoblet(15, "#49C95A")}</div>${fizz}<div class="tr-skull" style="animation-delay:${f1(T * 0.55)}s">${skull}</div></div>` +
      `<div class="tr-reach" style="--dur:${T}s">${hand}</div>${drops}`,
      "tr-poison", `left:${f1(x)}vw;bottom:10.5vh`, T);
    if (!box) return;
    appear(box.querySelector(".tr-cup"), T, 0, 0.08, 0.9);
    appear(box.querySelector(".tr-taint"), T, 0.38, 0.5, 0.9);
  }

  // candles out, and the room is full of eyes
  function trBlackout() {
    let eyes = "";
    for (let i = 0; i < 9; i++) {
      const b = rand(2.4, 4.2);
      eyes += `<div class="tr-eyes" style="left:${f1(rand(3, 95))}vw;top:${f1(rand(14, 86))}vh;--ed:${f1(b)}s;animation-delay:${f1(rand(1.2, 3.4))}s;--es:${f1(rand(0.7, 1.3))}"><b></b><b></b></div>`;
    }
    spawn(`<div class="tr-dark"></div>${eyes}<div class="tr-who">Who did it?</div>`, "sc-burst sc-fade", "--dur:10s", 10);
  }

  // a parchment note drops in the gap between two taps
  function trNote(inner, T = 10) {
    return spawn(`<div class="tr-note"><i class="tr-seal"></i>${inner}</div>`, "tr-note-box", `left:${pick(TR_GAPS)}vw;--dur:${T}s`, T);
  }
  const trLetter = () => trNote(`<small>A note, left at your place</small><p>${pick([
    "Trust no one", "One of you is lying", "Check your wine", "Meet me in the cellar",
    "You have been murdered", "Don't finish that glass", "I know what you did", "Someone here is not your friend",
  ])}</p>`);

  // the board turns on the drinks: one of what's on tap gets accused
  function trAccuse() {
    const names = (app.state?.taps || []).map((t) => t.beer?.name).filter(Boolean);
    trNote(`<small>The traitor is…</small><p class="who">${app.esc(names.length ? pick(names) : "The Host")}</p><b class="tr-stamp">Guilty</b>`);
  }

  // a hood slides out from behind a keg, has a look, and slips back
  function trPeek() {
    const kegs = [...document.querySelectorAll(".keg")];
    if (!kegs.length) return;
    const r = pick(kegs).getBoundingClientRect(), right = Math.random() < 0.5, T = 6;
    const hood = svgH("8 0 46 48", 10,
      `<path d="M32 2C18 2 13 16 15 30Q16 40 23 46L43 42Q49 30 46 17Q42 4 32 2Z" fill="${CLOTH}" stroke="${RIM}"/><path d="M35 13C28 14 26 23 28 30Q34 36 43 30Q46 21 42 15Q39 12 35 13Z" fill="#020102"/>` +
      `<g class="tr-blink" fill="#FF4B3E"><ellipse cx="34" cy="23" rx="1.9" ry="1.2"/><ellipse cx="40.5" cy="23" rx="1.7" ry="1.2"/></g>`);
    const left = right ? r.right - innerHeight * 0.096 : r.left;
    const box = spawn(`<div style="transform:scaleX(${right ? 1 : -1})">${hood}</div>`, "tr-peek", `left:${Math.round(left)}px;top:${Math.round(r.top + r.height * 0.18)}px`, T);
    if (!box) return;
    const d = right ? "5.4vh" : "-5.4vh";
    play$(box, [
      { transform: "translateX(0)", opacity: 0, offset: 0 }, { transform: `translateX(${d})`, opacity: 1, offset: 0.16, easing: "ease-out" },
      { transform: `translateX(${d})`, opacity: 1, offset: 0.78 }, { transform: "translateX(0)", opacity: 0, offset: 0.92 }, { transform: "translateX(0)", opacity: 0, offset: 1 }], T);
  }

  // deep purple with a lighter edge so they show up against the black wall
  const TR_BAT = `<path d="M22 9Q12 0 1 4Q7 7 7 11Q12 10 15 14Q19 11 22 12Q25 11 29 14Q32 10 37 11Q37 7 43 4Q32 0 22 9Z" fill="#4A2388" stroke="#A67BE0" stroke-width=".7"/>` +
    `<ellipse cx="22" cy="11" rx="3.4" ry="5" fill="#36176A" stroke="#A67BE0" stroke-width=".5"/><path d="M22 15L20 21H24Z" fill="#36176A"/><circle cx="20.8" cy="8.6" r=".8" fill="#FF4B3E"/><circle cx="23.2" cy="8.6" r=".8" fill="#FF4B3E"/>`;

  // blood seeps over the curtain and runs down the wall in fits and starts, behind the taps.
  // The long runs stay in the gaps between taps so names and numbers stay easy to read.
  function trBlood() {
    const T = 17, n = 24, runs = [];
    let drips = "";
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * (100 / n) + rand(-1.4, 1.4);
      const inGap = x < 3 || x > 97 || TR_GAPS.some((g) => Math.abs(x - g) < 6.5);
      const len = inGap ? rand(42, 86) : rand(11, 33), delay = rand(0.3, 2.6), bleed = rand(6, 11);
      drips += `<i class="tr-bleed" style="left:${f1(x)}vw;--w:${f1(rand(0.6, 1.6))}vh;--len:${f1(len)}vh;--bd:${f1(bleed)}s;animation-delay:${f1(delay)}s"></i>`;
      if (inGap) runs.push({ x, len, at: delay + bleed });
    }
    // a few of the long runs let go of a drop that splats on the tablecloth
    const drops = runs.sort(() => Math.random() - 0.5).slice(0, 4).map(({ x, len, at }) =>
      `<i class="tr-bdrop" style="left:${f1(x)}vw;top:${f1(len)}vh;--fall:${f1(88.4 - len)}vh;animation-delay:${f1(at)}s"></i>` +
      `<i class="tr-splat" style="left:${f1(x)}vw;animation-delay:${f1(at + 0.55)}s"></i>`).join("");
    let edge = "M0 0H100V5";
    for (let i = 10; i > 0; i--) edge += `Q${i * 10 - 5} ${f1(rand(6.5, 10))} ${(i - 1) * 10} ${f1(rand(3.5, 6))}`;
    const top = `<svg class="tr-blood-top" viewBox="0 0 100 10" preserveAspectRatio="none"><path d="${edge}Z" fill="#8E0E15"/></svg>`;
    spawn(`${drips}${drops}${top}`, "sc-burst tr-blood", `--dur:${T}s`, T);
  }

  // two glasses clink, with varying degrees of sincerity
  function trToast() {
    const x = pick(TR_GAPS);
    const sparks = Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2, r = rand(6, 10);
      return `<i class="tr-spark" style="--dx:${f1(Math.cos(a) * r)}vh;--dy:${f1(Math.sin(a) * r)}vh"></i>`;
    }).join("");
    const word = pick(["Cheers!", "To the faithful!", "Trust me!", "To your health…"]);
    spawn(`<div class="tr-clink l">${trGoblet(17)}</div><div class="tr-clink r">${trGoblet(17)}</div><div class="tr-sparks">${sparks}</div><div class="tr-cheers">${word}</div>`,
      "tr-toast", `left:${x}vw`, 6);
  }

  SURPRISES.traitors = {
    sneak: { w: 3, run: trSneak },
    magnifier: { w: 3, run: trMagnifier },
    murder: { w: 3, run: trMurder },
    poison: { w: 2, run: trPoison },
    peek: { w: 2, run: trPeek },
    letter: { w: 1.6, run: trLetter },
    accuse: { w: 1.6, run: trAccuse },
    toast: { w: 1.5, run: trToast },
    nightbats: { w: 1.3, run: () => cross(flock(TR_BAT, irand(3, 5), 8, 44), { y: rand(12, 24), dur: rand(9, 12), bob: "sc-flutter" }) },
    blackout: { w: 1.2, run: trBlackout },
    blood: { w: 2, run: trBlood },
  };

  // scene list for the console (seasons rotate under "auto"; the rest are themes)
  const FOOTBALL_ICON = `<ellipse cx="16" cy="16" rx="13" ry="8" fill="#9A5B2E" transform="rotate(-30 16 16)"/><path d="M11 19L21 13M13 15.4l1.6 2.6M15.6 13.8l1.6 2.6M18.2 12.2l1.6 2.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`;
  const VOLLEYBALL_ICON = `<circle cx="16" cy="16" r="12" fill="#F7F7F2"/><path d="M16 4Q8 12 11 28M16 4Q24 12 21 28M4.5 13Q16 18 27.5 13" stroke="#9A9A92" stroke-width="1.4" fill="none"/><path d="M16 4Q24 12 21 28Q27 22 27.5 13Q24 6 16 4Z" fill="#D00000"/>`;
  const TRAITORS_ICON = `<path d="M16 3C8 3 5 11 6 19Q4 24 3 29H29Q28 24 26 19Q27 11 16 3Z" fill="#7A1528"/><path d="M16 10C11.5 10 10 15 11.5 20Q16 23 20.5 20Q22 15 16 10Z" fill="#0B0608"/><circle cx="13.8" cy="16" r="1.3" fill="#FF4B3E"/><circle cx="18.2" cy="16" r="1.3" fill="#FF4B3E"/>`;
  const CATALOG = [
    { key: "spring", label: "Spring", seasonal: true },
    { key: "summer", label: "Summer", seasonal: true },
    { key: "fall", label: "Fall", seasonal: true },
    { key: "winter", label: "Winter", seasonal: true },
    { key: "gameday", label: "Game Day", icon: FOOTBALL_ICON },
    { key: "volleyball", label: "Volleyball", icon: VOLLEYBALL_ICON },
    { key: "traitors", label: "Traitors", icon: TRAITORS_ICON },
  ];

  // ================================================================ engine
  const S = { season: null, gap: GAPS.lively, timer: 0, last: null };

  function seasonOf(d = new Date()) {
    const m = d.getMonth();
    return m === 11 || m < 2 ? "winter" : m < 5 ? "spring" : m < 8 ? "summer" : "fall";
  }

  function build(season) {
    S.season = season;
    layer.dataset.season = season || "";
    document.documentElement.dataset.scene = season || ""; // lets a scene recolor the whole board
    layer.innerHTML = season ? `<div class="sc-ambient">${AMBIENT[season]()}</div><div class="sc-actors"></div>` : "";
  }

  function weight(s) { return typeof s.w === "function" ? s.w() : s.w; }

  function play(name) {
    if (!S.season) return false;
    const list = SURPRISES[S.season];
    let entry = name && list[name];
    if (!entry && name) { // allow ?surprise=santa from any scene, for testing
      for (const season of Object.keys(SURPRISES)) if (SURPRISES[season][name]) entry = SURPRISES[season][name];
    }
    if (!entry) {
      const names = Object.keys(list).filter((n) => n !== S.last || Object.keys(list).length === 1);
      const total = names.reduce((t, n) => t + weight(list[n]), 0);
      let r = Math.random() * total;
      name = names.find((n) => (r -= weight(list[n])) <= 0) || names[0];
      entry = list[name];
    }
    S.last = name;
    entry.run();
    return name;
  }

  function schedule() {
    clearTimeout(S.timer);
    if (!S.season || reducedMotion) return;
    S.timer = setTimeout(() => {
      // skip while the console covers the board or the screen is off
      if (!document.hidden && !document.body.classList.contains("console-open")) play();
      schedule();
    }, rand(...S.gap) * 1000);
  }

  let current = "";
  function set(look) {
    const forced = params.get("scene");
    const scene = forced || look?.scene || "auto";
    const season = scene === "off" ? null : scene === "auto" ? seasonOf() : scene;
    const gap = GAPS[look?.surprises] || GAPS.lively;
    const key = `${scene}|${season}|${gap}`;
    if (key === current) return;
    const rebuild = season !== S.season || !layer.firstChild;
    current = key;
    S.gap = gap;
    if (rebuild) build(season);
    schedule();
  }

  // "auto" follows the calendar; check now and then so it flips on the first of the month
  setInterval(() => { if (current.startsWith("auto|") && seasonOf() !== S.season) { current = ""; set(app.state?.appearance); } }, 3600 * 1000);

  app.scenery = { set, play, seasonOf, catalog: CATALOG, surprises: (scene) => Object.keys(SURPRISES[scene] || {}) };

  // start from the last-known setting so a reload shows the scene straight away
  try { set(JSON.parse(localStorage.getItem("taps.appearance"))); } catch { set(null); }
  if (params.get("surprise")) setTimeout(() => play(params.get("surprise")), 800);
})();
