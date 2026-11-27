# Sound Seer

Audio tricorder for phone and tablet microphones. Web-first (test in Android Chrome), with an optional Capacitor 6 Android shell.

Repo: [funky49/SS_RF1](https://github.com/funky49/SS_RF1) (Sound Seer refactor). Companion to [P1_BassLab](https://github.com/funky49/basslab1.6ff).

## Features

- **Top strip** — live mic waveform  
- **DATA** — dB, RMS, peak (+ hold), pitch/note, ZCR, spectral centroid, loudness with real-world comparisons, mic disclaimer, multi-mic best-input picker  
- **GRAPH** — waveform, FFT bars, spectrogram, circular/radial, waterfall; zoom bands; frequency band color markers; fullscreen + portrait  
- **TOYS** — mic/device info, sound toys (sweep, Quindar, bird, noise+HPF), flash-to-bang, room size, RPM, leak/hiss, loudness dose, periodicity, pitch/note, BPM (auto + tap)

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
| `npm run cap:sync` | Copy web assets into Android project |
| `npm run cap:open:android` | Open Android Studio |

## Disclaimer

Levels are **not** calibrated SPL. They depend on device mic hardware. Real-world comparisons and dose estimates are for orientation only — not medical, safety, or legal certification.
