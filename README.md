# Smart Taps

A tap list display and management system for a home kegerator, built for a
Raspberry Pi 5 with a touch display.

- **The display (what guests see).** A chalkboard with one column per tap: a brass
  medallion (the beer's logo, or the tap number), the name in chalk handwriting, style
  and ABV, and a keg gauge filled with the beer's real color (from its SRM, or
  red/white/rosé for wine) showing % and gallons left. It bubbles while someone is
  pouring. The wine tap has a **Charge CO2** button, and the cabinet temperature sits
  top right.
- **The console (gear icon, top right).** Swap what's on each tap from your
  beer library, mark a keg as kicked, start a fresh keg, set how full a keg is (until
  flow meters do it for you), and charge CO₂. Everything is done by tapping; there's no
  keyboard on screen. You can lock it with a PIN.
- **The `taps` CLI (over SSH).** Add new beers from your Mac, edit them, and
  import or export the library.

Stack:
- **Backend:** Python 3.12, FastAPI, SQLite, gpiozero/lgpio
- **Frontend:** plain HTML/CSS/JS served by nginx, with fonts bundled so it works offline
- **Runs locally** with Docker Compose. No cloud services.

---

## Quick start

```bash
docker compose up --build
```

On first start the backend creates `data/config.toml` and the database.

| What | URL |
|---|---|
| The display (on the Pi's touch screen) | http://localhost:8080/?kiosk=1 (`?kiosk=1` hides the mouse cursor) |
| From your phone or Mac, same Wi-Fi | `http://<pi-hostname>.local:8080` |
| Straight into the console | `http://<pi-hostname>.local:8080/?console` |
| API docs | http://localhost:8001/docs (from the Pi itself only) |

Ports can be changed with `APP_PORT` and `API_PORT`, either in `.env` (see `.env.example`) or inline:
`APP_PORT=9000 docker compose up -d`. If this runs on the same Pi as Workout Pal, change both, since
those are the same defaults.

**Try it with fake hardware** (simulated temperature probe, flow meters, CO₂ relay, and random pours):

```bash
TAPS_MOCK=1 TAPS_DEMO_POURS=1 docker compose up --build
./taps demo        # loads five sample beers onto the taps
```

> **Security:** the console PIN only keeps guests off the touch screen. Don't expose port 8080 to
> the internet.

### On the Pi

Same as Workout Pal: copy the folder over, run `docker compose up -d --build` once, and Docker
starts it again on every boot (`restart: unless-stopped`). From your Mac:

```bash
./deploy/push.sh pi@kegerator.local     # rsyncs to ~/smart-taps and runs docker compose up -d --build
```

Run `push.sh` again after any change. The display notices the server restarted and reloads itself.
Your `data/` and `.env` on the Pi are never touched.

Point the touch screen's kiosk browser at `http://localhost:8080/?kiosk=1`, the same way you did for
Workout Pal. If you'd rather use a script, `deploy/kiosk.sh` waits for the app and then opens
Chromium full-screen (instructions inside). For landscape, set the screen's **Orientation** in
**Raspberry menu → Preferences → Screen Configuration**. There's also a portrait layout (2 × 2 taps)
if you mount it vertically.

---

## Day-to-day: managing beers

The `./taps` script in the project folder runs the CLI inside the backend container
(it's `docker compose exec backend taps …`).

```bash
ssh pi@kegerator.local
cd smart-taps
./taps                     # what's on tap
./taps add                 # add a new beer; it asks you questions
./taps tap 2 pliny         # put it on tap 2 (fresh keg). Name, partial name, or #id
./taps kick 2              # tap 2 ran dry
./taps beers               # your library, most recently tapped first
./taps edit pliny          # fix a typo, add tasting notes
./taps --help              # everything else
```

**Tip:** add this to `~/.zshrc` on your Mac and you can run `taps add` right from your Mac:

```bash
alias taps='ssh -t pi@kegerator.local smart-taps/taps'
```

Adding a beer in one line works too, for example:
`taps add --name "Hazy Little Thing" --maker "Sierra Nevada" --style "Hazy IPA" --abv 6.7 --ibu 40 --color gold --tap 1`

For wine, use `--kind wine --color red` (or `white`, `rose`, `orange`).
Colors can be an SRM number (1 to 40), a word (`straw`, `gold`, `amber`,
`copper`, `brown`, `black`), or a `#hex` value.

**Logos** go in the brass medallion. Point it at an image URL, or copy a file into the
project's `data/` folder first:

```bash
./taps logo pliny https://example.com/pliny-logo.png
scp pliny.png pi@kegerator.local:smart-taps/data/ && ssh pi@kegerator.local 'cd smart-taps && ./taps logo pliny data/pliny.png'
./taps logo pliny --clear
```

Round or square logos look best (they're cropped to a circle). PNG, JPG, WebP, SVG or GIF, up to 5 MB.

To bulk-load beers, put them in a JSON list (run `taps export` to see the format) and pipe it in:
`ssh pi@kegerator.local 'cd smart-taps && ./taps import -' < beers.json`

Set `TAPS_SSH_TARGET` in `.env` (e.g. `pi@kegerator.local`) so the touch console shows the right SSH command.

---

## Where your data lives

Everything is in `data/`, mounted into the backend container at `/data`:

```
data/
  config.toml    bar name, console PIN, temperature range, keg default, sensor pins
  taps.db        SQLite: beer library, keg history, pour log
  logos/         beer logos added with `taps logo`
```

It survives `docker compose down`, restarts and rebuilds. After editing `config.toml`, run
`docker compose restart backend`. To back up, copy `data/` somewhere safe while the app is stopped.

---

## Adding the hardware later

Everything below is already supported in code. Wire it up, set the pins in `data/config.toml`,
and restart. Each piece is optional and independent; the display only shows what's actually installed.

**First, give the container access to the GPIO pins** (one time):

```bash
cp docker-compose.pi-hardware.yml docker-compose.override.yml
docker compose up -d
```

`docker compose` loads the override file automatically. It passes the Pi 5's GPIO chip
(`/dev/gpiochip0`) into the backend. It isn't in the main compose file because that device
doesn't exist on a Mac, so `docker compose up` would fail there.

Suggested pins (BCM numbering):

| Part                    | GPIO | Header pin |
|-------------------------|------|-----------|
| DS18B20 temp probe      | 4    | 7         |
| Flow meter, tap 1       | 17   | 11        |
| Flow meter, tap 2       | 27   | 13        |
| Flow meter, tap 3       | 22   | 15        |
| Flow meter, tap 4       | 23   | 16        |
| CO₂ relay (wine tap)    | 24   | 18        |

### Temperature (DS18B20 waterproof probe)

1. Wiring: red → 3.3V, black → GND, yellow (data) → GPIO4, with a **4.7 kΩ resistor
   between data and 3.3V**. Many probe "adapter boards" include the resistor.
2. On the Pi (not in Docker), add `dtoverlay=w1-gpio` to `/boot/firmware/config.txt` and reboot.
3. `ls /sys/bus/w1/devices/` should list a `28-…` device.
4. In `data/config.toml`, under `[temperature]`, set `enabled = true`, then run `docker compose restart backend`.
   A temperature chip appears in the top bar. It turns amber if the kegerator gets warm.

Tape the probe to the side of a keg, or drop it in a small jar of water inside the
fridge, so you read beer temperature rather than air temperature.

### Flow meters

Use **food-safe** inline flow meters rated for beer, installed in the beer line between keg and shank.

- **Voltage:** Pi GPIO pins are **3.3 V only**. Most meters are open-collector, which works fine with the
  Pi's internal pull-up that the app enables. If yours pushes 5 V on the signal wire, put a voltage
  divider (e.g. 10 kΩ / 20 kΩ) or a level shifter in between.
- Set `flow_pin` for each tap in `data/config.toml` and restart.
- **Calibrate:** run `./taps calibrate 1 --ml 500`, pour exactly 500 ml into a measuring jug, press Enter,
  and copy the suggested `pulses_per_liter` into the config. Do it 2 or 3 times and average.
- When you put a new keg on, choose the keg size in the console (or `--keg sixtel` in the CLI) so the
  level starts from the right volume.
- Until a tap has a meter, its gauge shows whatever you last set: **How full is it?** in the console
  (Full / 75 / 50 / 25 / 10%), or `./taps level 2 60`.

With meters installed, the gauges drain on their own, the % turns copper under 15%,
and every pour bubbles live. Each pour is also logged for future stats.

### CO₂ boost for the wine keg

A 12 V normally-closed solenoid valve on a gas line to the wine keg, driven by a relay module.

- Relay module IN → GPIO24, VCC → 5V, GND → GND. Most cheap boards are **active-low**; that's the
  default (`co2_relay_active_high = false`).
- The solenoid must be powered from its own 12 V supply through the relay's COM/NO contacts.
  Put a flyback diode across the solenoid if the relay board doesn't have one.
- Set `co2_relay_pin` on the wine tap in `data/config.toml` (tap 1 in the example config). That tap gets
  the **Charge CO2** button on the main screen (one pulse of the first `co2_boost_seconds` value), and
  the console offers every value in the list.

Safety: the main-screen button isn't behind the PIN, so anyone pouring wine can use it. Every charge is a
timed pulse with a hard cap (`co2_max_seconds`, default 10 s) enforced by the server, plus a short
cooldown between charges. The relay is forced off when the backend starts and
stops. Keep a regulator with a pressure relief valve upstream of the solenoid. The
relay only opens the gas; it never sets the pressure.

---

## Development

Docker (above) is the easy way. To run without Docker, with the API and UI on one port and hot editing of the frontend:

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
TAPS_MOCK=1 TAPS_DEMO_POURS=1 .venv/bin/python -m taps serve      # http://localhost:8000
.venv/bin/python -m taps demo                                    # in another terminal
```

This uses `../data` by default (`TAPS_DATA_DIR` overrides it). To trigger a pour in mock mode:
`curl -X POST localhost:8000/api/dev/pour/2`.

### Project layout

```
docker-compose.yml               backend + frontend (nginx), same shape as Workout Pal
docker-compose.pi-hardware.yml   GPIO passthrough; copy to docker-compose.override.yml on the Pi
taps                             ./taps … → runs the CLI in the backend container
backend/
  taps/
    server.py      FastAPI JSON API (/api/state, /api/beers, /api/taps/{id}/…)
    cli.py         the `taps` command
    db.py          SQLite: beers, kegs, taps, pours
    colors.py      SRM / wine color → hex
    config.py      reads data/config.toml
    hardware/      temperature.py (DS18B20), flow.py (meters), relay.py (CO₂) + mock versions
  config.example.toml   copied to data/config.toml on first start
frontend/
  index.html, static/   chalkboard display + console (plain JS), bundled fonts (Caveat, Barlow Condensed)
  nginx.conf            serves the UI, proxies /api to the backend
deploy/
  push.sh        rsync to the Pi + docker compose up -d --build
  kiosk.sh       optional Chromium kiosk launcher
data/            config + database (created at runtime)
```

- The display polls `/api/state` once a second, so changes made from the CLI show up right away.
- The CLI and server share the SQLite database. Flow meters write volume *increments*, so the two
  never clobber each other.
- Beers that have been on tap are archived by `taps rm` rather than deleted, which keeps keg history intact.
- The display is fluid (sized from the screen's height and width), so it fits any panel. The console
  stacks into a single column on a phone.
