#!/usr/bin/env node
// Zero-dependency static server for www/. Usage: node scripts/serve.mjs [port]
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../www", import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

// ES modules refuse to load unless .js is served with a JavaScript MIME type.
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

function resolvePath(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const full = normalize(join(root, p));
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    const st = statSync(full);
    if (st.isDirectory()) return resolvePath(join(p, "index.html"));
    return full;
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  const file = resolvePath(req.url || "/");
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": types[extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(file).pipe(res);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is in use. Try: npm start -- ${port + 1}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  console.log(`Sound Seer serving ${root}\n`);
  console.log(`  Local:   http://localhost:${port}/   (mic works here)`);
  for (const ip of lan) console.log(`  LAN:     http://${ip}:${port}/   (UI only; mic needs HTTPS or localhost)`);
  console.log(`\n  Phone over USB:  adb reverse tcp:${port} tcp:${port}  then open http://localhost:${port}/`);
  console.log(`  Ctrl+C to stop.`);
});
