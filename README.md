# Sound Seer

Audio tricorder for phone and tablet microphones. Web-first (test in Android Chrome), with an optional Capacitor 6 Android shell.

Repo: [funky49/SS_RF1](https://github.com/funky49/SS_RF1) (Sound Seer refactor). Companion to [P1_BassLab](https://github.com/funky49/basslab1.6ff).

## Features

- **Top strip** — live mic waveform  
- **DATA** — dB, RMS, peak (+ hold), pitch/note, ZCR, spectral centroid, loudness with real-world comparisons, mic disclaimer, multi-mic best-input picker  
- **GRAPH** — waveform, oscilloscope, FFT bars, spectrogram, circular/radial, waterfall; zoom presets; frequency band color markers; frequency-axis zoom/pan and band zoom buttons; fullscreen + portrait  
- **TOYS** — Settings (units: Metric / American), mic/device info, sound toys (sweep, Quindar, bird, noise+HPF), flash-to-bang, room size, RPM, leak/hiss, loudness dose, periodicity, pitch/note, BPM (auto + tap), **mosquito detector**, **approaching-aircraft detector**

### Mosquito + aircraft detectors (TOYS)

Both are *sound-pattern spotters* built on the shared mic/analyser (no extra mic stream); DSP lives in `www/js/detectors.js`, UI glue in `www/js/detector-ui.js`. They only run while their panel is open and the screen is on.

- **Mosquito detector** — looks for a narrow tone at ~300–900 Hz that holds within ±25 Hz for ~1 s, sits ≥12 dB above the local noise floor, and has 2x/3x harmonics. Shows none / possible / likely, wingbeat Hz, a 300–900 Hz spectrum zoom, a detection log, and optional vibrate/beep. Works only when the mosquito is very close to the mic in a quiet room; whistles, beeps, fans and mains hum can false-trigger it.
- **Aircraft detector** — scores helicopter (10–40 Hz rotor modulation), drone (100–400 Hz harmonic series, pitch wobble, high whine), propeller airplane (low tonal series) and jet/airplane (low-frequency broadband rumble). Approaching / receding comes from the smoothed level trend over ~10 s, plus Doppler pitch drift for tonal sounds (a weak cue). Wind, traffic, HVAC and fans cause false positives; confidence is a heuristic score, not a probability, and this is not reliable identification.

### Zooming the spectrum (GRAPH tab)

In FFT bars, spectrogram, waterfall and radial views you can zoom into the frequency axis (spectrogram: vertical axis):

- **Pinch** with two fingers to zoom, **drag** to pan; on desktop use the **mouse wheel** to zoom and **drag** to pan (horizontal wheel/shift+wheel pans). **Double-tap / double-click** resets the view.
- **Band buttons** under the graph (All, Sub-bass 20–60 Hz, Bass, Low mid, Mid, High mid, Presence, Brilliance) animate the view to that band; the strip scrolls horizontally on small screens. Manual pinch/pan clears the highlighted button.
- The view is limited to 20 Hz up to the top of the selected **Zoom** preset. Picking a preset (20–80, 80–3000, 20–20k, 20–64k) resets the view to that range. Zoom state is not persisted.

### Oscilloscope (GRAPH → View → Oscilloscope)

Time-domain scope with a 10 × 8 graticule, green phosphor trace with adjustable persistence, and a control strip under the canvas (works in fullscreen and portrait; no canvas gestures are registered).

- **Trigger** — rising edge at an adjustable level with hysteresis (0.1 div). Modes: *Auto* (free-runs when nothing triggers), *Normal* (holds the last triggered trace, shows WAIT), *Off*. The amber dashed line and arrow mark the level; the small triangle marks the trigger point (1 div from the left).
- **Time/div** — 0.2 to 10 ms/div, computed from the real sample rate. The analyser buffer is 4096 samples, so spans longer than the buffer minus a trigger search margin (≈8 ms/div at 44.1 kHz) are clamped and the UI says so.
- **Amplitude** — normalized units/div (full scale = ±1, 0.25 u/div at x1) with x1–x16 gain; uncalibrated, not volts. Uses `getFloatTimeDomainData` when available for low-level resolution (byte path still used elsewhere).
- **Readouts** — frequency from the trigger period, Vpp and RMS (normalized) of the pulled buffer. Freeze/Run holds a trace; Peak hold draws a faint max/min envelope (cleared by *Reset hold*).

## Try it on your phone (easiest)

Open **https://funky49.github.io/SS_RF1/** in Android Chrome and tap **Enable mic**. It is HTTPS, so the mic works with no setup. Every push to `main` that touches `www/` redeploys it (see [Deploying to GitHub Pages](#deploying-to-github-pages)).

## Run locally (no build, no Android tooling)

`www/` is plain HTML/CSS/ES modules. There is no build step; any static web server works.

```bash
npm install   # optional for the web app; only the Capacitor shell needs the packages
npm start     # zero-dependency Node server for www/ on port 4173 (Node 18+)
```

Then open `http://localhost:4173/`. Use another port with `npm start -- 8080` or `PORT=8080 npm start`.

Other static servers work too:

```bash
python3 -m http.server 4173 -d www
npx serve www -l 4173
```

Do **not** open `www/index.html` by double-clicking it. Browsers block ES modules on `file://` pages, so the app cannot start (it shows a message saying so).

## Microphone needs HTTPS or localhost

`getUserMedia` only works in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts): an `https://` URL, or `http://localhost` / `http://127.0.0.1`. On `http://<lan-ip>:4173` the UI loads but the browser hides the mic; the app shows a red notice when that happens.

Ways to test on an Android phone:

1. **GitHub Pages (HTTPS)**: open https://funky49.github.io/SS_RF1/. Nothing to install.
2. **USB + adb reverse** (to test local, unpushed changes): enable USB debugging on the phone, plug it in, then on the computer:
   ```bash
   npm start
   adb reverse tcp:4173 tcp:4173
   ```
   On the phone open `http://localhost:4173/`. Chrome treats it as secure, so the mic works.
3. **Chrome flag over Wi-Fi** (no cable, local changes): run `npm start`, then on the phone open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://<your-computer-lan-ip>:4173` (the LAN URL `npm start` prints), set it to Enabled, relaunch Chrome, and open that URL. This is for testing only.
4. **HTTPS tunnel** (any network): for example `npx localtunnel --port 4173` or `cloudflared tunnel --url http://localhost:4173`, then open the `https://` URL it prints.
5. **Capacitor Android WebView**: see below.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` publishes `www/` to GitHub Pages on every push to `main` that changes `www/` (or run it manually from the Actions tab).

One-time setup: in the repo go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Then re-run the "Deploy www to GitHub Pages" workflow from the **Actions** tab. The site is at https://funky49.github.io/SS_RF1/.

Until the source is switched, the workflow skips deployment with a notice, and Pages keeps serving the repo root from the `main` branch; the root `index.html` redirects to `www/`, so the same URL still opens the app.

## Capacitor Android (optional)

```bash
npm install
npx cap add android   # once
npx cap sync android
npx cap open android
```

`webDir` is `www`. Grant `RECORD_AUDIO` when prompted.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm start` | Zero-dependency static server for `www` on port 4173 (prints local + LAN URLs) |
| `npm run serve` | Same as `npm start` |
| `npm test` | Node unit tests (`tests/*.test.js`, `tests/*.test.mjs`; Node 18+) |
| `npm run cap:sync` | Copy web assets into Android project |
| `npm run cap:open:android` | Open Android Studio |

## Units (Metric / American)

TOYS → Settings has a Metric / American toggle, saved in `localStorage` (`soundseer.units.v1`). The default comes from `navigator.language` (`*-US` → American, otherwise Metric); a saved choice wins. Frequencies, dB, BPM and RPM are never converted.

Reuse in new tools with `www/js/units.js`: compute in SI, format for display, and re-render on change.

```js
import { formatDistance, formatLength, formatSpeed, formatTemperature,
         temperatureToCelsius, onUnitsChange, getSystem } from "./units.js";

formatDistance(meters);        // "343 m" / "1.50 km"  |  "1125 ft" / "0.93 mi"
formatLength(meters);          // "4.3 m" / "50 cm"    |  "14.1 ft" / "4 in"
formatSpeed(mps);              // "343.0 m/s"          |  "1125.3 ft/s"  ({ large: true } → km/h | mph)
formatTemperature(celsius);    // "20.0°C"             |  "68.0°F"       ({ digits: 0 })
const c = temperatureToCelsius(inputValue, getSystem());   // user input → SI
onUnitsChange(() => render());                             // live updates
```

In HTML, `<span data-unit="temperature">°C</span>` is relabelled automatically (`temperature`, `length`, `distance`, `speed`). Run the unit tests with `npm test`.

## Disclaimer

Levels are **not** calibrated SPL. They depend on device mic hardware. Real-world comparisons and dose estimates are for orientation only — not medical, safety, or legal certification.
