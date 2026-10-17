/* Smart Liasse hors ligne : les appels /api/ sont servis par le moteur local (worker.js). */
window.SL_WEB = true;
(function () {
  const worker = new Worker("worker.js");
  const pending = new Map();
  let seq = 0, ready = false;
  const veil = document.createElement("div");
  veil.id = "sl-boot";
  veil.innerHTML = '<div class="b"><div class="sp"></div><b>Smart Liasse</b><p id="sl-boot-t">Démarrage…</p><small>Tout fonctionne sur cet appareil, sans connexion internet.</small></div>';
  const css = document.createElement("style");
  css.textContent = `#sl-boot{position:fixed;inset:0;background:#f4f6f9;z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,Arial,sans-serif}
#sl-boot .b{text-align:center;max-width:320px;padding:20px;color:#1f3a5f}#sl-boot p{margin:10px 0 6px}#sl-boot small{color:#667}
#sl-boot .sp{width:38px;height:38px;border:4px solid #c9d4e3;border-top-color:#1f3a5f;border-radius:50%;margin:0 auto 14px;animation:slr 1s linear infinite}
@keyframes slr{to{transform:rotate(360deg)}}
#sl-busy{position:fixed;right:14px;bottom:14px;background:#1f3a5f;color:#fff;padding:8px 14px;border-radius:6px;font:13px Segoe UI,Arial;z-index:9998;display:none}`;
  document.head.appendChild(css);
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(veil));
  const busy = document.createElement("div"); busy.id = "sl-busy"; busy.textContent = "Calcul en cours…";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(busy));
  let nbusy = 0;
  const setBusy = (d) => { nbusy += d; busy.style.display = nbusy > 0 && ready ? "block" : "none"; };

  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "progress") {
      const t = document.getElementById("sl-boot-t"); if (t) t.textContent = m.text;
      if (m.text === "Prêt") { ready = true; veil.remove(); }
    } else if (m.type === "fatal") {
      const t = document.getElementById("sl-boot-t"); if (t) t.textContent = "Erreur au démarrage : " + m.text;
    } else if (m.type === "res") {
      const p = pending.get(m.id); pending.delete(m.id);
      if (p) p(m);
    }
  };

  function isApi(u) { return typeof u === "string" ? u.indexOf("/api/") >= 0 : false; }
  function apiPath(u) { const s = String(u); return s.slice(s.indexOf("/api/")); }

  async function local(url, init) {
    const req = new Request(new URL(apiPath(url), location.origin), init || {});
    const headers = {}; req.headers.forEach((v, k) => { headers[k] = v; });
    const body = ["GET", "HEAD"].includes(req.method) ? null : await req.arrayBuffer();
    const id = ++seq;
    setBusy(1);
    const m = await new Promise((ok) => {
      pending.set(id, ok);
      worker.postMessage({ type: "req", id, method: req.method, url: apiPath(url), headers, body }, body ? [body] : []);
    });
    setBusy(-1);
    return new Response(m.status === 204 ? null : m.body, { status: m.status, headers: m.headers });
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === "string" ? input : (input && input.url) || "";
    return isApi(u) ? local(u, init) : nativeFetch(input, init);
  };

  function fileName(resp, href) {
    const cd = resp.headers.get("content-disposition") || "";
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    if (m) return decodeURIComponent(m[1]);
    const ct = resp.headers.get("content-type") || "";
    const ext = ct.includes("pdf") ? "pdf" : ct.includes("sheet") ? "xlsx" : ct.includes("json") ? "json" : "bin";
    return "smart_liasse." + ext;
  }

  // liens de telechargement / d'ouverture des PDF et fichiers Excel
  document.addEventListener("click", async (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!isApi(href)) return;
    e.preventDefault();
    const ouvrir = a.target === "_blank" && !/Android|iPhone|iPad/i.test(navigator.userAgent);
    const w = ouvrir ? window.open("", "_blank") : null;
    if (w) w.document.write("<p style='font-family:Arial;padding:30px'>Préparation du document…</p>");
    try {
      const r = await local(href);
      if (!r.ok) throw new Error("Erreur " + r.status);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      if (w) { w.location.href = url; }
      else {
        const d = document.createElement("a"); d.href = url; d.download = fileName(r, href);
        document.body.appendChild(d); d.click(); d.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (err) {
      if (w) w.close();
      alert("Le document n'a pas pu être produit : " + err.message);
    }
  }, true);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
