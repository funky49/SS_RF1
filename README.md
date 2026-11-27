# Sound Seer

Audio tricorder for phone and tablet microphones. Web-first (test in Android Chrome), with an optional Capacitor 6 Android shell.

Repo: [funky49/SS_RF1](https://github.com/funky49/SS_RF1) (Sound Seer refactor). Companion to [P1_BassLab](https://github.com/funky49/basslab1.6ff).

## Features

- **Top strip** — live mic waveform  
- **DATA** — dB, RMS, peak (+ hold), pitch/note, ZCR, spectral centroid, loudness with real-world comparisons, mic disclaimer, multi-mic best-input picker  
- **GRAPH** — waveform, FFT bars, spectrogram, circular/radial, waterfall; zoom bands; frequency band color markers; fullscreen + portrait  
- **TOYS** — mic/device info, sound toys (sweep, Quindar, bird, noise+HPF), flash-to-bang, room size, RPM, leak/hiss, loudness dose, periodicity, pitch/note, BPM (auto + tap), **mosquito detector**, **approaching-aircraft detector**

### Mosquito + aircraft detectors (TOYS)

Both are *sound-pattern spotters* built on the shared mic/analyser (no extra mic stream); DSP lives in `www/js/detectors.js`, UI glue in `www/js/detector-ui.js`. They only run while their panel is open and the screen is on.

- **Mosquito detector** — looks for a narrow tone at ~300–900 Hz that holds within ±25 Hz for ~1 s, sits ≥12 dB above the local noise floor, and has 2x/3x harmonics. Shows none / possible / likely, wingbeat Hz, a 300–900 Hz spectrum zoom, a detection log, and optional vibrate/beep. Works only when the mosquito is very close to the mic in a quiet room; whistles, beeps, fans and mains hum can false-trigger it.
- **Aircraft detector** — scores helicopter (10–40 Hz rotor modulation), drone (100–400 Hz harmonic series, pitch wobble, high whine), propeller airplane (low tonal series) and jet/airplane (low-frequency broadband rumble). Approaching / receding comes from the smoothed level trend over ~10 s, plus Doppler pitch drift for tonal sounds (a weak cue). Wind, traffic, HVAC and fans cause false positives; confidence is a heuristic score, not a probability, and this is not reliable identification.

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
| `npm test` | Unit tests for the detector DSP (synthetic signals, Node 18+) |
| `npm run serve` | Static server for `www` on port 4173 |
| `npm run cap:sync` | Copy web assets into Android project |
| `npm run cap:open:android` | Open Android Studio |

## Disclaimer

Levels are **not** calibrated SPL. They depend on device mic hardware. Real-world comparisons and dose estimates are for orientation only — not medical, safety, or legal certification.
