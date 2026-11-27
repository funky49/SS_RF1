# Sound Seer

Audio tricorder for phone and tablet microphones. Web-first (test in Android Chrome), with an optional Capacitor 6 Android shell.

Repo: [funky49/SS_RF1](https://github.com/funky49/SS_RF1) (Sound Seer refactor). Companion to [P1_BassLab](https://github.com/funky49/basslab1.6ff).

## Features

- **Top strip** — live mic waveform  
- **DATA** — dB, RMS, peak (+ hold), pitch/note, ZCR, spectral centroid, loudness with real-world comparisons, mic disclaimer, multi-mic best-input picker  
- **GRAPH** — waveform, oscilloscope, FFT bars, spectrogram, circular/radial, waterfall; zoom bands; frequency band color markers; fullscreen + portrait  
- **TOYS** — mic/device info, sound toys (sweep, Quindar, bird, noise+HPF), flash-to-bang, room size, RPM, leak/hiss, loudness dose, periodicity, pitch/note, BPM (auto + tap)

### Oscilloscope (GRAPH → View → Oscilloscope)

Time-domain scope with a 10 × 8 graticule, green phosphor trace with adjustable persistence, and a control strip under the canvas (works in fullscreen and portrait; no canvas gestures are registered).

- **Trigger** — rising edge at an adjustable level with hysteresis (0.1 div). Modes: *Auto* (free-runs when nothing triggers), *Normal* (holds the last triggered trace, shows WAIT), *Off*. The amber dashed line and arrow mark the level; the small triangle marks the trigger point (1 div from the left).
- **Time/div** — 0.2 to 10 ms/div, computed from the real sample rate. The analyser buffer is 4096 samples, so spans longer than the buffer minus a trigger search margin (≈8 ms/div at 44.1 kHz) are clamped and the UI says so.
- **Amplitude** — normalized units/div (full scale = ±1, 0.25 u/div at x1) with x1–x16 gain; uncalibrated, not volts. Uses `getFloatTimeDomainData` when available for low-level resolution (byte path still used elsewhere).
- **Readouts** — frequency from the trigger period, Vpp and RMS (normalized) of the pulled buffer. Freeze/Run holds a trace; Peak hold draws a faint max/min envelope (cleared by *Reset hold*).

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
| `npm test` | Unit tests (`node --test tests/*.test.js`) |
| `npm run cap:sync` | Copy web assets into Android project |
| `npm run cap:open:android` | Open Android Studio |

## Disclaimer

Levels are **not** calibrated SPL. They depend on device mic hardware. Real-world comparisons and dose estimates are for orientation only — not medical, safety, or legal certification.
