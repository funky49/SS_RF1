# Sound Seer

Audio tricorder for phone and tablet microphones. Web-first (test in Android Chrome), with an optional Capacitor 6 Android shell.

Repo: [funky49/SS_RF1](https://github.com/funky49/SS_RF1) (Sound Seer refactor). Companion to [P1_BassLab](https://github.com/funky49/basslab1.6ff).

## Features

- **Top strip** — live mic waveform  
- **DATA** — dB, RMS, peak (+ hold), pitch/note, ZCR, spectral centroid, loudness with real-world comparisons, mic disclaimer, multi-mic best-input picker  
- **GRAPH** — waveform, FFT bars, spectrogram, circular/radial, waterfall; zoom presets; frequency band color markers; frequency-axis zoom/pan and band zoom buttons; fullscreen + portrait  
- **TOYS** — mic/device info, sound toys (sweep, Quindar, bird, noise+HPF), flash-to-bang, room size, RPM, leak/hiss, loudness dose, periodicity, pitch/note, BPM (auto + tap)

### Zooming the spectrum (GRAPH tab)

In FFT bars, spectrogram, waterfall and radial views you can zoom into the frequency axis (spectrogram: vertical axis):

- **Pinch** with two fingers to zoom, **drag** to pan; on desktop use the **mouse wheel** to zoom and **drag** to pan (horizontal wheel/shift+wheel pans). **Double-tap / double-click** resets the view.
- **Band buttons** under the graph (All, Sub-bass 20–60 Hz, Bass, Low mid, Mid, High mid, Presence, Brilliance) animate the view to that band; the strip scrolls horizontally on small screens. Manual pinch/pan clears the highlighted button.
- The view is limited to 20 Hz up to the top of the selected **Zoom** preset. Picking a preset (20–80, 80–3000, 20–20k, 20–64k) resets the view to that range. Zoom state is not persisted.

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
| `npm run cap:sync` | Copy web assets into Android project |
| `npm run cap:open:android` | Open Android Studio |

## Disclaimer

Levels are **not** calibrated SPL. They depend on device mic hardware. Real-world comparisons and dose estimates are for orientation only — not medical, safety, or legal certification.
