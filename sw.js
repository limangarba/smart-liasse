/* Smart Liasse : mise en cache complete pour un fonctionnement sans connexion. */
const CACHE = "smartliasse-2.1-1f99f8e4eb";
const FILES = ["./", "apple-touch-icon.png", "bridge.js", "icone-192.png", "icone-512.png", "index.html", "manifest.webmanifest", "worker.js", "pyodide/MarkupSafe-2.1.5-cp312-cp312-pyodide_2024_0_wasm32.whl", "pyodide/app.zip", "pyodide/pillow-10.2.0-cp312-cp312-pyodide_2024_0_wasm32.whl", "pyodide/pyodide-lock.json", "pyodide/pyodide.asm.js", "pyodide/pyodide.asm.wasm", "pyodide/pyodide.js", "pyodide/python_stdlib.zip", "pyodide/site.zip", "pyodide/sqlite3-1.0.0.zip", "static/app.css", "static/app.js", "static/armoiries.png", "static/icone.svg", "static/logo_dgi.png", "static/logo_dgi2.png", "static/logo_tap.jpeg", "static/smartliasse.ico"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((resp) => {
    if (resp.ok && new URL(e.request.url).origin === location.origin) {
      const copy = resp.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return resp;
  }).catch(() => caches.match("./"))));
});
