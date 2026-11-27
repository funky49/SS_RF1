# Sound Seer

Audio tricorder for phone and tablet microphones. Web-first (test in Android Chrome), with an optional Capacitor 6 Android shell.

Repo: [funky49/SS_RF1](https://github.com/funky49/SS_RF1) (Sound Seer refactor). Companion to [P1_BassLab](https://github.com/funky49/basslab1.6ff).

## Features

- **Top strip** — live mic waveform  
- **DATA** — dB, RMS, peak (+ hold), pitch/note, ZCR, spectral centroid, loudness with real-world comparisons, mic disclaimer, multi-mic best-input picker  
- **GRAPH** — waveform, FFT bars, spectrogram, circular/radial, waterfall; zoom bands; frequency band color markers; fullscreen + portrait  
- **TOYS** — Settings (units: Metric / American), mic/device info, sound toys (sweep, Quindar, bird, noise+HPF), flash-to-bang, room size, RPM, leak/hiss, loudness dose, periodicity, pitch/note, BPM (auto + tap)

## Serve for Android Chrome testing

```bash
npm install
npm run serve
```

Open `http://<your-lan-ip>:4173` on the phone (HTTPS or localhost is required for mic on many browsers — see notes below).

### Mic over LAN

`getUserMedia` needs a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). Options:

1. **USB debugging + port forward** (recommended):
   ```bash
   adb reverse tcp:4173 tcp:4173
   ```
   Then on the phone open `http://127.0.0.1:4173` (treated as secure on Chrome).

2. Serve behind HTTPS (tunnel or local cert).

3. Capacitor Android WebView after `npm run cap:add:android && npm run cap:sync`.

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
| `npm run serve` | Static server for `www` on port 4173 |
| `npm test` | Node unit tests (`tests/*.test.js`) |
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
