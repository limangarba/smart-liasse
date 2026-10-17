/* Smart Liasse - moteur de calcul hors ligne (Python/Pyodide dans un Web Worker). */
importScripts("pyodide/pyodide.js");
let py = null;
const ready = (async () => {
  const say = (t) => postMessage({ type: "progress", text: t });
  say("Chargement du moteur Python…");
  py = await loadPyodide({ indexURL: new URL("pyodide/", self.location.href).href });
  say("Chargement des modules (Excel, PDF, base de données)…");
  await py.loadPackage(["sqlite3", "pillow", "markupsafe"]);
  for (const [f, dir] of [["pyodide/site.zip", "/lib/python3.12/site-packages"], ["pyodide/app.zip", "/app"]]) {
    const buf = new Uint8Array(await (await fetch(f)).arrayBuffer());
    py.unpackArchive(buf, "zip", { extractDir: dir });
  }
  // donnees persistantes : base enregistree dans le stockage du navigateur (IndexedDB)
  py.FS.mkdirTree("/data");
  py.FS.mount(py.FS.filesystems.IDBFS, {}, "/data");
  await new Promise((ok, ko) => py.FS.syncfs(true, (e) => (e ? ko(e) : ok())));
  say("Préparation du modèle de liasse…");
  await py.runPythonAsync(`
import sys, os
sys.path.insert(0, "/app")
os.environ["SMART_LIASSE_DATA"] = "/data"
os.environ["SMART_LIASSE_WEB"] = "1"
from liasse.server import app as _app
from liasse.model import get_model
get_model()
_client = _app.test_client()

def _requete(method, url, headers, body):
    hd = {k: v for k, v in headers.to_py().items()} if headers is not None else {}
    data = bytes(body.to_py()) if body is not None else None
    rv = _client.open(url, method=method, headers=hd, data=data)
    out = rv.get_data()
    return rv.status_code, list(rv.headers.items()), out
`);
  say("Prêt");
})();

let chain = Promise.resolve();
function persist() {
  return new Promise((ok) => py.FS.syncfs(false, () => ok()));
}

onmessage = (ev) => {
  const m = ev.data;
  if (m.type !== "req") return;
  // requetes traitees une par une (le moteur n'est pas reentrant)
  chain = chain.then(async () => {
    try {
      await ready;
      const fn = py.globals.get("_requete");
      const res = fn(m.method, m.url, m.headers || null, m.body ? new Uint8Array(m.body) : null);
      const [status, headers, body] = res.toJs({ dict_converter: Object.fromEntries });
      res.destroy(); fn.destroy();
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
      if (m.method !== "GET") await persist();
      postMessage({ type: "res", id: m.id, status, headers, body: bytes.buffer }, [bytes.buffer]);
    } catch (e) {
      postMessage({ type: "res", id: m.id, status: 500, headers: [["Content-Type", "application/json"]],
        body: new TextEncoder().encode(JSON.stringify({ erreur: String(e && e.message || e) })).buffer });
    }
  });
};
ready.catch((e) => postMessage({ type: "fatal", text: String(e && e.message || e) }));
