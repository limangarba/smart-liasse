/* Smart Liasse – interface (hors ligne, sans dependance externe) */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, dec = 0) => {
  if (v === null || v === undefined || v === "" || isNaN(v)) return "";
  const n = Number(v);
  if (Math.abs(n) < 0.5 && dec === 0) return "-";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace(/ /g, " ");
};
const num = (s) => {
  // meme lecture que le serveur : 1 234 567 | 1.234.567 | 1,234,567 | 1234,50 | (12 000) | 12 000 F CFA
  if (s === null || s === undefined || s === "") return 0;
  if (typeof s === "number") return s;
  let t = String(s).trim().replace(/\s*(f\s*cfa|fcfa|xof|francs?|f)\.?\s*$/i, "").replace(/[\s   ']/g, "").replace("%", "");
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }
  if (/^[-+]?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  else t = t.replace(",", ".");
  const v = Number(t);
  return isNaN(v) ? 0 : (neg ? -v : v);
};

async function api(path, opts = {}) {
  const o = Object.assign({ headers: {} }, opts);
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers["Content-Type"] = "application/json"; o.method = o.method || "POST"; }
  const r = await fetch(path, o);
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.erreur) || ("Erreur " + r.status));
  return data;
}

function toast(msg, ms = 2200) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}
function modal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

const MENU = [
  ["Pilotage", [["bord", "Tableau de bord"], ["rapport", "Rapport de gestion"], ["alertes", "Alertes"], ["controles", "Contrôles de cohérence"], ["conformite", "Conformité d'une liasse"]]],
  ["Données", [["societe", "Société et exercice"], ["balance_n", "Balance N"], ["balance_n1", "Balance N-1"],
    ["ventilation", "Ventilation des comptes"], ["immo", "Immobilisations"]]],
  ["Fiscalité", [["fiscal", "IMF / ISB, déficits"], ["reglements", "Acomptes et précomptes"], ["passage", "Tableau de passage"],
    ["bordereau", "Bordereau de versement"], ["tap", "Taxe d'apprentissage"], ["tcfge", "TCFGE"]]],
  ["Liasse", [["textes", "Textes des notes"], ["pages", "Pages de la liasse"], ["export", "Exporter"]]],
];

const App = {
  d: null, id: null, view: "bord", plan: null, leaf: null, synth: null, saveTimer: null,

  async init() {
    this.plan = await api("/api/plan");
    const h = location.hash.match(/^#d(\d+)(?:\/(\w+))?/);
    if (h) { await this.open(+h[1], h[2] || "bord"); } else { this.home(); }
  },

  // ------------------------------------------------------------- accueil
  async home() {
    this.d = null; this.id = null; location.hash = "";
    $("#side").classList.add("hidden");
    $("#dossier-title").textContent = "";
    $("#top-actions").innerHTML = "";
    await this.flush();
    const list = this._list = await api("/api/dossiers");
    const rows = list.map((x) => `<tr><td><b>${esc(x.societe)}</b></td><td>${x.annee ?? ""}</td><td class="muted">${esc(x.modifie || "")}</td>
      <td class="right"><button class="btn sm primary" onclick="App.open(${x.id})">Ouvrir</button>
      <button class="btn sm" onclick="App.nextYear(${x.id})" title="Crée l'exercice suivant avec reprise des données N-1">Exercice suivant</button>
      <button class="btn sm" onclick="App.dup(${x.id})">Dupliquer</button>
      <a class="btn sm" href="/api/dossiers/${x.id}/sauvegarde">Sauvegarder</a>
      <button class="btn sm danger" onclick="App.del(${x.id})">Supprimer</button></td></tr>`).join("");
    $("#main").innerHTML = `
      <h1>Dossiers</h1>
      <p class="sub">Un dossier correspond à une société et un exercice. La liasse (fiches, bilan, compte de résultat, TFT, notes annexes, états supplémentaires DGI, TAP et TCFGE) est calculée à partir de la balance, du tableau des immobilisations et des données N-1.</p>
      <div class="row" style="margin-bottom:14px">
        <button class="btn primary" onclick="App.newDossier()">+ Nouveau dossier</button>
        <label class="btn accent" title="Liasse complète au format Excel (modèle Smart Liasse ou autre) ou PDF : vérification de conformité, reprise, modification et rapport">Importer une liasse (Excel ou PDF)<input type="file" accept=".xlsx,.xlsm,.pdf" class="hidden" onchange="App.importLiasse(this)"></label>
        <span class="flex1"></span><button class="btn" onclick="App.quitter()">Quitter</button>
        <label class="btn">Restaurer une sauvegarde (.json)<input type="file" accept=".json" class="hidden" onchange="App.restore(this)"></label>
      </div>
      <div class="card" style="padding:0">${list.length ? `<table class="t"><thead><tr><th>Société</th><th>Exercice</th><th>Modifié</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="vide">Aucun dossier pour l'instant. Créez le premier dossier pour commencer.</div>`}</div>`;
  },

  newDossier() {
    const y = new Date().getFullYear() - 1;
    modal(`<h2 style="margin-top:0">Nouveau dossier</h2>
      <div class="grid-form">
        <div class="f"><label>Dénomination sociale</label><input id="nd-den" placeholder="Ex. : SOCIÉTÉ X SARL"></div>
        <div class="f"><label>NIF</label><input id="nd-nif"></div>
        <div class="f"><label>Exercice (année de clôture)</label><input id="nd-an" type="number" value="${y}"></div>
      </div>
      <div class="row" style="margin-top:16px"><button class="btn primary" onclick="App.createDossier()">Créer</button><button class="btn" onclick="closeModal()">Annuler</button></div>`);
    setTimeout(() => $("#nd-den").focus(), 50);
  },
  async createDossier() {
    const r = await api("/api/dossiers", { json: { denomination: $("#nd-den").value, nif: $("#nd-nif").value, annee: $("#nd-an").value } });
    closeModal(); this.open(r.id, "societe");
  },
  async dup(id) { const r = await api(`/api/dossiers/${id}/dupliquer`, { method: "POST" }); toast("Dossier dupliqué"); this.home(); },
  async nextYear(id) {
    if (!confirm("Créer l'exercice suivant ?\n\nSont repris : identité, balance N (devient N-1), immobilisations non cédées avec leurs amortissements cumulés, déficits reportables, amortissements réputés différés, TAP à déduire, colonne N-1 du TFT, historique de la note 31 et saisies textuelles.")) return;
    const r = await api(`/api/dossiers/${id}/exercice-suivant`, { method: "POST" });
    toast("Exercice suivant créé : importez la balance N"); this.open(r.id, "balance_n");
  },
  async del(id) {
    const x = (this._list || []).find((y) => y.id === id) || {};
    if (!confirm(`Supprimer définitivement le dossier « ${x.societe || ""} – ${x.annee || ""} » ?`)) return;
    await api(`/api/dossiers/${id}`, { method: "DELETE" }); this.home();
  },
  async importLiasse(inp, did) {
    const f = inp.files[0]; if (!f) return;
    modal(`<h2 style="margin-top:0">Lecture de la liasse</h2><p>${esc(f.name)}</p><p class="muted">Lecture des états, reprise des données et recalcul complet… (quelques secondes)</p>`);
    const fd = new FormData(); fd.append("fichier", f);
    try {
      if (did) {
        const r = await api(`/api/dossiers/${did}/liasse-reference`, { method: "POST", body: fd });
        closeModal(); toast(`${r.postes} postes lus`); this.go("conformite");
      } else {
        const r = await api("/api/import/liasse", { method: "POST", body: fd });
        closeModal(); toast(`Liasse importée : ${r.postes} postes lus`); this.open(r.id, "conformite");
      }
    } catch (e) {
      modal(`<h2 style="margin-top:0">Import impossible</h2><p>${esc(e.message)}</p><div class="row"><button class="btn" onclick="closeModal()">Fermer</button></div>`);
    }
    inp.value = "";
  },
  async restore(inp) {
    const fd = new FormData(); fd.append("fichier", inp.files[0]);
    const r = await api("/api/restauration", { method: "POST", body: fd });
    toast("Dossier restauré"); this.open(r.id);
  },

  // ------------------------------------------------------------- dossier
  async open(id, view) {
    this.d = await api(`/api/dossiers/${id}`);
    this.id = id;
    ["identite", "exercice", "params", "cells", "textes", "tap", "tcfge", "options", "mapping"].forEach((k) => { if (!this.d[k] || Array.isArray(this.d[k])) this.d[k] = {}; });
    ["balance_n", "balance_n1", "immobilisations", "activites", "reglements", "formations"].forEach((k) => { if (!Array.isArray(this.d[k])) this.d[k] = []; });
    $("#side").classList.remove("hidden");
    $("#top-actions").innerHTML = `<span class="saved" id="saved"></span>
      <a class="btn" href="/api/dossiers/${id}/export.xlsx">Excel</a>
      <a class="btn accent" href="/api/dossiers/${id}/export.pdf?dl=1">PDF de la liasse</a>`;
    this.title();
    this.go(view || this.view || "bord");
  },
  title() {
    const i = this.d.identite || {}, e = this.d.exercice || {};
    $("#dossier-title").textContent = `${i.denomination || "Société"} · exercice ${e.annee || ""}`;
  },
  menu() {
    $("#side").innerHTML = MENU.map(([g, items]) => `<div class="grp">${g}</div>` + items.map(([k, l]) =>
      `<a class="${k === this.view ? "active" : ""}" onclick="App.go('${k}')"><span class="dot" id="dot-${k}"></span>${l}</a>`).join("")).join("")
      + `<div class="grp">Application</div><a onclick="App.home()"><span class="dot"></span>Tous les dossiers</a><a onclick="App.quitter()"><span class="dot"></span>Quitter Smart Liasse</a><a onclick="App.apropos()"><span class="dot"></span>À propos / corrections</a>`;
    this.dots();
  },
  dots() {
    const set = (k, c) => { const e = $("#dot-" + k); if (e) e.className = "dot " + c; };
    set("balance_n", this.d.balance_n.length ? "ok" : "ko");
    set("balance_n1", this.d.balance_n1.length ? "ok" : "warn");
    set("societe", this.d.identite.denomination && this.d.identite.nif ? "ok" : "warn");
    set("immo", this.d.immobilisations.length ? "ok" : "");
    if (this.alerts) {
      const e = $("#dot-alertes");
      const crit = this.alerts.filter((a) => a.niveau === "critique").length, an = this.alerts.filter((a) => a.niveau === "anomalie").length;
      if (e) { e.className = "dot " + (crit ? "ko" : an ? "warn" : "ok"); const lk = e.parentElement; if (lk && !lk.querySelector(".cnt") && this.alerts.length) lk.insertAdjacentHTML("beforeend", `<span class="cnt">${this.alerts.length}</span>`); }
    }
    if (this.synth) {
      const ko = this.synth.controles.filter((c) => !c.ok).length;
      set("controles", ko ? "ko" : "ok");
      set("ventilation", this.synth.non_ventiles.length ? "ko" : (this.synth.approx.length ? "warn" : "ok"));
    }
  },
  async go(view) {
    await this.flush();
    this.view = view;
    location.hash = `#d${this.id}/${view}`;
    this.menu();
    const f = this["v_" + view];
    $("#main").innerHTML = "";
    if (f) f.call(this);
  },
  ALL_PARTS: ["identite", "exercice", "params", "textes", "tap", "tcfge", "options", "mapping", "activites", "immobilisations", "reglements", "formations", "rapport"],
  save(part, quiet) {
    // enregistrement automatique differe ; les demandes successives sont cumulees (aucune saisie perdue)
    const parts = part || this.ALL_PARTS;
    this._parts = this._parts || new Set();
    parts.forEach((k) => this._parts.add(k));
    this._waiters = this._waiters || [];
    clearTimeout(this.saveTimer);
    $("#saved") && ($("#saved").textContent = "modification…");
    return new Promise((res, rej) => {
      this._waiters.push([res, rej]);
      this.saveTimer = setTimeout(() => this.flush(), quiet ? 50 : 500);
    });
  },
  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this._parts || !this._parts.size || !this.d) return;
    const parts = [...this._parts], waiters = this._waiters || [];
    this._parts = new Set(); this._waiters = [];
    const body = {};
    parts.forEach((k) => body[k] = this.d[k]);
    try {
      await api(`/api/dossiers/${this.id}`, { method: "PUT", json: body });
      $("#saved") && ($("#saved").textContent = "enregistré " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
      this.title();
      waiters.forEach(([r]) => r());
    } catch (e) {
      $("#saved") && ($("#saved").textContent = "échec de l'enregistrement");
      toast("Enregistrement impossible : " + e.message, 5000);
      waiters.forEach(([, j]) => j(e));
    }
  },
  async synthese() {
    const [s, a] = await Promise.all([api(`/api/dossiers/${this.id}/synthese`), api(`/api/dossiers/${this.id}/alertes`)]);
    this.synth = s; this.alerts = a; this.menu(); return s;
  },

  // ------------------------------------------------------- tableau de bord
  async v_bord() {
    $("#main").innerHTML = `<h1>Tableau de bord</h1><p class="sub">Chiffres clés calculés à partir des données saisies. Cliquez sur « PDF de la liasse » pour générer le document complet.</p><div id="kp">Calcul…</div>`;
    const s = await this.synthese();
    const k = (l, v, sub, neg) => `<div class="kpi"><div class="l">${l}</div><div class="v ${neg && v < 0 ? "neg" : ""}">${fmt(v)}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
    const ko = s.controles.filter((c) => !c.ok);
    const bal = s.totaux["N"];
    $("#kp").innerHTML = `
      ${!this.d.balance_n.length ? `<div class="card" style="border-color:#f0c9a3;background:#fff8f0"><b>Étape suivante :</b> importez la balance générale de l'exercice. <button class="btn sm primary" onclick="App.go('balance_n')">Importer la balance N</button></div>` : ""}
      <div class="kpis">
        ${k("Chiffre d'affaires", s.ca, "N-1 : " + fmt(s.ca_n1))}
        ${k("Valeur ajoutée", s.va, "", true)}
        ${k("Excédent brut d'exploitation", s.ebe, "", true)}
        ${k("Résultat net", s.resultat, "N-1 : " + fmt(s.resultat_n1), true)}
        ${k("Total bilan", s.total_bilan, s.total_bilan === s.total_passif ? "Actif = Passif" : "Écart actif / passif : " + fmt(s.total_bilan - s.total_passif))}
        ${k("Capitaux propres", s.capitaux_propres, "", true)}
        ${k("Trésorerie nette", s.tresorerie, "", true)}
        ${k("Résultat fiscal", s.resultat_fiscal, s.resultat_fiscal < 0 ? "Perte fiscale" : "Bénéfice fiscal", true)}
        ${k("Impôt dû (IMF / ISB)", Math.max(s.imf, s.isb), s.imf >= s.isb ? "IMF retenu" : "ISB retenu")}
        ${k("Solde IMF/ISB à payer", s.reliquat, s.reliquat < 0 ? "Crédit d'impôt" : "Après acomptes et précomptes", true)}
        ${k("Taxe d'apprentissage", s.tap)}
        ${k("TCFGE", s.tcfge)}
        ${k("Total du bordereau", s.total_a_payer)}
        ${k("Déficits reportables", s.deficit_reportable, "ARD : " + fmt(s.ard))}
      </div>
      ${App.alertSummary()}
      <div class="card"><h2 style="margin-top:0">Contrôles</h2>
        ${ko.length ? `<p><span class="tag ko">${ko.length} anomalie(s)</span> ${ko.map((c) => esc(c.libelle)).join(" · ")}</p>` : `<p><span class="tag ok">Tous les contrôles sont satisfaits</span></p>`}
        ${bal ? `<p class="muted">Balance N : débit ${fmt(bal[0])} – crédit ${fmt(bal[1])}</p>` : ""}
        ${s.non_ventiles.length ? `<p><span class="tag ko">${s.non_ventiles.length} compte(s) non ventilé(s)</span> <a href="#" onclick="App.go('ventilation');return false">corriger</a></p>` : ""}
        ${s.approx.length ? `<p><span class="tag warn">${s.approx.length} compte(s) ventilé(s) par approximation</span> <a href="#" onclick="App.go('ventilation');return false">vérifier</a></p>` : ""}
        <button class="btn sm" onclick="App.go('controles')">Détail des contrôles</button>
      </div>`;
  },

  async v_rapport() {
    $("#main").innerHTML = `<h1>Rapport de gestion financière</h1><p class="sub">Analyse de la performance de l'exercice, des faiblesses, tableau de bord des indicateurs et recommandations pour améliorer le résultat et préserver la santé financière. Le rapport est calculé à partir des états de la liasse ; vos observations s'ajoutent en fin de document.</p><div id="rp">Analyse…</div>`;
    const r = await api(`/api/dossiers/${this.id}/rapport`);
    const R = this.d.rapport = (this.d.rapport && !Array.isArray(this.d.rapport)) ? this.d.rapport : {};
    if (R.signature === undefined) { R.signature = "G.H. Liman"; this.save(["rapport"]); }
    const col = { vert: "ok", orange: "warn", rouge: "ko", gris: "" };
    const lab = { vert: "Bon", orange: "À surveiller", rouge: "Critique", gris: "–" };
    const v = (x, f) => x === null || x === undefined ? "–" : f === "p" ? (x * 100).toFixed(1).replace(".", ",") + " %" : f === "x" ? x.toFixed(2).replace(".", ",") : f === "j" ? Math.round(x) + " j" : fmt(x);
    $("#rp").innerHTML = `
      <div class="card"><div class="row"><div class="flex1"><h2 style="margin:0">${esc(r.appreciation || "")}</h2>
        <div class="muted">${r.score !== null ? Math.round(r.score * 100) + " / 100 sur les indicateurs du tableau de bord" : ""}</div></div>
        <a class="btn accent" href="/api/dossiers/${this.id}/rapport.pdf?dl=1">Télécharger le rapport (PDF)</a>
        <a class="btn" href="/api/dossiers/${this.id}/rapport.pdf" target="_blank">Ouvrir</a></div></div>
      <div class="row" style="align-items:flex-start;gap:16px">
        <div class="card flex1"><h2 style="margin-top:0">Points forts</h2><ul>${r.forces.map((x) => `<li>${esc(x)}</li>`).join("") || "<li class='muted'>Aucun point fort significatif.</li>"}</ul></div>
        <div class="card flex1"><h2 style="margin-top:0">Faiblesses</h2><ul>${r.faiblesses.map((x) => `<li>${esc(x)}</li>`).join("") || "<li class='muted'>Aucune faiblesse majeure.</li>"}</ul></div>
      </div>
      <div class="card" style="padding:0"><table class="t"><thead><tr><th>Indicateur</th><th class="n">N</th><th class="n">N-1</th><th>État</th><th>Repère</th></tr></thead><tbody>
        ${r.ratios.map((x) => `<tr><td>${esc(x.libelle)}</td><td class="n">${v(x.n, x.fmt)}</td><td class="n">${v(x.n1, x.fmt)}</td><td><span class="tag ${col[x.statut]}">${lab[x.statut]}</span></td><td class="muted">${esc(x.seuil)}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="card"><h2 style="margin-top:0">Recommandations</h2>${r.conseils.map((c, i) => `<p><b>${i + 1}. ${esc(c.titre)}</b><br>${esc(c.texte)}</p>`).join("")}</div>
      <div class="card"><h2 style="margin-top:0">Observations du consultant et signature</h2>
        <textarea style="min-height:160px" placeholder="Vos observations, contexte de l'exercice, mesures déjà engagées…" oninput="App.d.rapport.commentaire=this.value;App.save(['rapport'])">${esc(R.commentaire || "")}</textarea>
        <div class="grid-form" style="margin-top:10px"><div class="f"><label>Signature</label><input value="${esc(R.signature || "")}" oninput="App.d.rapport.signature=this.value;App.save(['rapport'])"></div>
        <div class="f"><label>Lieu</label><input value="${esc(R.lieu || "Niamey")}" oninput="App.d.rapport.lieu=this.value;App.save(['rapport'])"></div></div></div>`;
  },

  async v_conformite() {
    $("#main").innerHTML = `<h1>Conformité d'une liasse</h1><p class="sub">Vérification d'une liasse déjà établie (fichier Excel ou PDF) : contrôles arithmétiques des états tels que déposés, comparaison poste par poste avec le recalcul de l'application, cohérence entre les pages, mentions obligatoires. Après correction des données du dossier, relancez la vérification puis exportez la liasse corrigée.</p><div id="cf">Vérification…</div>`;
    const v = await api(`/api/dossiers/${this.id}/conformite`);
    const inp = `<label class="btn">Choisir un fichier (Excel ou PDF)<input type="file" accept=".xlsx,.xlsm,.pdf" class="hidden" onchange="App.importLiasse(this, ${this.id})"></label>`;
    if (v.vide) {
      $("#cf").innerHTML = `<div class="card"><h2 style="margin-top:0">Aucune liasse de référence</h2>
        <p>Rattachez à ce dossier une liasse déjà déposée ou établie par un autre outil : l'application la compare au calcul effectué à partir de vos données, sans rien modifier dans le dossier.</p>
        <p class="muted">Pour reprendre intégralement une liasse dans un nouveau dossier, utilisez « Importer une liasse » depuis la liste des dossiers.</p>${inp}</div>`;
      return;
    }
    const tagv = { "conforme": "ok", "conforme avec réserves": "warn", "non conforme": "ko" }[v.verdict];
    const lab = { critique: ["ko", "Critique"], anomalie: ["warn", "Anomalie"], manquement: ["info", "Manquement"], imperfection: ["", "À vérifier"] };
    const ko = v.controles.filter((c) => !c.ok);
    const ctrl = [...ko, ...v.controles.filter((c) => c.ok)];
    $("#cf").innerHTML = `
      <div class="card"><div class="row"><div class="flex1"><span class="tag ${tagv}" style="font-size:14px;padding:4px 12px">Liasse ${esc(v.verdict)}</span>
        <p style="margin:8px 0 0">${esc(v.commentaire)}</p>
        <div class="muted" style="margin-top:6px">${esc(v.fichier || "")} · ${esc(v.mode || "")} · importé le ${esc(v.date || "")} · ${v.nb_codes} postes lus</div></div>
        <div style="display:flex;flex-direction:column;gap:6px"><a class="btn accent" href="/api/dossiers/${this.id}/conformite.pdf?dl=1">Rapport de conformité (PDF)</a>
        <a class="btn" href="/api/dossiers/${this.id}/conformite.pdf" target="_blank">Ouvrir le rapport</a>
        <button class="btn" onclick="App.go('conformite')">Relancer la vérification</button></div></div></div>
      <div class="kpis">
        <div class="kpi"><div class="l">Contrôles satisfaits</div><div class="v">${v.controles.length - ko.length} / ${v.controles.length}</div></div>
        <div class="kpi"><div class="l">Écarts avec le recalcul</div><div class="v">${v.ecarts.length}</div></div>
        <div class="kpi"><div class="l">Incohérences entre pages</div><div class="v">${v.conflits.length}</div></div>
        <div class="kpi"><div class="l">Alertes du dossier</div><div class="v">${v.alertes.length}</div><div class="s"><a href="#" onclick="App.go('alertes');return false">voir le détail</a></div></div>
      </div>
      <div class="card" style="padding:0"><h2 style="margin:14px 18px 8px">Contrôles arithmétiques de la liasse déposée</h2><table class="t"><thead><tr><th>Contrôle</th><th class="n">Montant</th><th class="n">Attendu</th><th class="n">Écart</th><th>Résultat</th></tr></thead><tbody>
        ${ctrl.map((c) => `<tr><td>${esc(c.libelle)}</td><td class="n">${fmt(c.a)}</td><td class="n">${fmt(c.b)}</td><td class="n">${c.ok ? "" : fmt(c.ecart)}</td>
          <td>${c.ok ? '<span class="tag ok">Conforme</span>' : `<span class="tag ${lab[c.niveau][0]}">${lab[c.niveau][1]}</span>`}</td></tr>`).join("")}</tbody></table></div>
      <div class="card" style="padding:0"><h2 style="margin:14px 18px 8px">Écarts entre la liasse déposée et le recalcul</h2>
        ${v.ecarts.length ? `<table class="t"><thead><tr><th>État</th><th>Réf.</th><th>Poste</th><th>Colonne</th><th class="n">Déclaré</th><th class="n">Recalculé</th><th class="n">Écart</th></tr></thead><tbody>
        ${v.ecarts.map((e) => `<tr><td class="muted">${esc(e.section)}</td><td><b>${esc(e.code)}</b></td><td>${esc(e.libelle)}</td><td>${esc(e.colonne)}</td><td class="n">${fmt(e.declare)}</td><td class="n">${fmt(e.recalcule)}</td><td class="n"><b>${fmt(e.ecart)}</b></td></tr>`).join("")}</tbody></table>`
        : `<p style="margin:0 18px 16px"><span class="tag ok">Aucun écart</span> Les montants déclarés sont identiques au recalcul.</p>`}</div>
      ${v.conflits.length ? `<div class="card" style="padding:0"><h2 style="margin:14px 18px 8px">Incohérences entre pages</h2><table class="t"><thead><tr><th>Réf.</th><th>Page</th><th>Montants</th><th>Autre page</th><th>Montants</th></tr></thead><tbody>
        ${v.conflits.map((c) => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.page1)}</td><td>${c.valeurs1.map((x) => fmt(x)).join(" / ")}</td><td>${esc(c.page2)}</td><td>${c.valeurs2.map((x) => fmt(x)).join(" / ")}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <div class="card"><h2 style="margin-top:0">Actions correctives recommandées</h2>${v.recommandations.map((c, i) => `<p><b>${i + 1}. ${esc(c.titre)}</b><br>${esc(c.texte)}</p>`).join("")}</div>
      ${v.notes.length ? `<div class="card"><h2 style="margin-top:0">Conditions de reprise</h2><ul>${v.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
      <div class="card"><h2 style="margin-top:0">Fichier de référence</h2><div class="row">${inp.replace("Choisir un fichier", "Remplacer par un autre fichier")}
        <button class="btn danger" onclick="App.delRef()">Retirer la liasse de référence</button></div></div>`;
  },
  async delRef() {
    if (!confirm("Retirer la liasse de référence ? Les données du dossier sont conservées.")) return;
    await api(`/api/dossiers/${this.id}/conformite`, { method: "DELETE" }); this.go("conformite");
  },

  alertSummary() {
    const a = this.alerts || [];
    if (!a.length) return `<div class="card"><h2 style="margin-top:0">Alertes</h2><span class="tag ok">Aucune alerte</span></div>`;
    const n = (k) => a.filter((x) => x.niveau === k).length;
    return `<div class="card"><h2 style="margin-top:0">Alertes</h2>
      <div class="row">${n("critique") ? `<span class="tag ko">${n("critique")} critique(s)</span>` : ""}${n("anomalie") ? `<span class="tag warn">${n("anomalie")} anomalie(s)</span>` : ""}
      ${n("manquement") ? `<span class="tag info">${n("manquement")} manquement(s)</span>` : ""}${n("imperfection") ? `<span class="tag">${n("imperfection")} imperfection(s)</span>` : ""}
      <button class="btn sm" onclick="App.go('alertes')">Voir le détail</button></div>
      <ul style="margin:10px 0 0 18px;padding:0">${a.slice(0, 5).map((x) => `<li>${esc(x.titre)}</li>`).join("")}</ul></div>`;
  },

  async v_alertes() {
    $("#main").innerHTML = `<h1>Alertes</h1><p class="sub">Anomalies, incohérences, imperfections et manquements relevés sur le dossier. Les alertes <b>critiques</b> rendent la liasse irrecevable ou fausse ; les <b>anomalies</b> sont des incohérences chiffrées ; les <b>manquements</b> sont des informations obligatoires absentes ; les <b>imperfections</b> sont à vérifier ou à compléter. La liste se met à jour à chaque modification.</p><div id="al">Analyse…</div>`;
    await this.synthese();
    const lab = { critique: ["ko", "Critique"], anomalie: ["warn", "Anomalie"], manquement: ["info", "Manquement"], imperfection: ["", "Imperfection"] };
    $("#al").innerHTML = this.alerts.length ? `<div class="card" style="padding:0"><table class="t"><thead><tr><th>Niveau</th><th>Alerte</th><th>Détail</th><th></th></tr></thead><tbody>
      ${this.alerts.map((a) => `<tr><td><span class="tag ${lab[a.niveau][0]}">${lab[a.niveau][1]}</span></td><td><b>${esc(a.titre)}</b></td><td class="muted">${esc(a.detail)}</td>
        <td>${a.vue ? `<button class="btn sm" onclick="App.go('${a.vue}')">Corriger</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="vide">Aucune alerte : le dossier est complet et cohérent.</div>`;
  },

  // ------------------------------------------------------- acomptes et precomptes
  async v_reglements() {
    if (!this.types) this.types = await api("/api/types-reglements");
    const R = this.d.reglements = Array.isArray(this.d.reglements) ? this.d.reglements : [];
    const opt = (v) => this.types.map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${esc(l)}</option>`).join("");
    const I = (n, k, cls = "", type = "text") => `<input class="${cls}" type="${type}" value="${esc(R[n][k] ?? "")}" onchange="App.d.reglements[${n}]['${k}']=this.value;App.saveRegl()">`;
    const tot = {}; R.forEach((r) => tot[r.type] = (tot[r.type] || 0) + num(r.montant));
    $("#main").innerHTML = `<h1>Acomptes, précomptes et crédits d'impôt</h1>
      <p class="sub">Registre des sommes imputables sur l'IMF ou l'ISB : acomptes provisionnels (1er, 2e, 3e), précomptes perçus en douane sur les importations, précomptes retenus par les clients ou l'État, retenues prélevées par les banques, crédit d'impôt. Les totaux alimentent automatiquement le tableau de passage (lignes « acomptes », « crédit d'impôt », « précompte ISB ») et le bordereau de versement ; le détail est joint à la liasse (état annexe).</p>
      <div class="row" style="margin-bottom:10px">
        <button class="btn primary" onclick="App.d.reglements.push({type:'precompte_douane'});App.v_reglements()">+ Ligne</button>
        <label class="btn">Importer un relevé de douane<input type="file" accept=".xlsx,.xls,.csv" class="hidden" onchange="App.importRegl(this,'precompte_douane')"></label>
        <label class="btn">Importer un relevé bancaire<input type="file" accept=".xlsx,.xls,.csv" class="hidden" onchange="App.importRegl(this,'precompte_banque')"></label>
        <label class="btn">Importer des attestations clients<input type="file" accept=".xlsx,.xls,.csv" class="hidden" onchange="App.importRegl(this,'precompte_client')"></label>
        <label class="btn">Importer des acomptes<input type="file" accept=".xlsx,.xls,.csv" class="hidden" onchange="App.importRegl(this,'acompte1')"></label>
      </div>
      <div class="card" style="padding:0"><table class="t"><thead><tr><th style="min-width:250px">Nature</th><th>Date</th><th>Référence (quittance, n° déclaration)</th><th>Tiers / bureau</th><th class="n">Base</th><th class="n">Taux %</th><th class="n">Montant</th><th></th></tr></thead><tbody>
      ${R.map((r, n) => `<tr><td><select onchange="App.d.reglements[${n}].type=this.value;App.saveRegl(true)">${opt(r.type)}</select></td><td>${I(n, "date", "", "date")}</td><td>${I(n, "reference")}</td><td>${I(n, "tiers")}</td>
        <td style="width:120px">${I(n, "base", "n")}</td><td style="width:70px">${I(n, "taux", "n")}</td><td style="width:120px">${I(n, "montant", "n")}</td>
        <td><button class="btn sm danger" onclick="App.d.reglements.splice(${n},1);App.saveRegl(true)">×</button></td></tr>`).join("") || `<tr><td colspan="8" class="muted" style="padding:16px">Aucune ligne. Ajoutez les quittances ou importez un relevé (colonnes : date, référence, tiers, base, montant du précompte).</td></tr>`}
      </tbody></table></div>
      <div class="card"><h2 style="margin-top:0">Totaux reportés</h2><table class="t" style="max-width:620px"><tbody>
      ${this.types.map(([k, l]) => `<tr><td>${esc(l)}</td><td class="n">${fmt(tot[k] || 0)}</td></tr>`).join("")}
      </tbody></table><p class="help">Lorsqu'une nature figure au registre, son total remplace la saisie de l'écran « IMF / ISB, déficits ». Le montant reste modifiable à tout moment dans le tableau de passage.</p></div>`;
  },
  saveRegl(redraw) { this.save(["reglements"]).then(() => { if (redraw) this.v_reglements(); }); },
  async importRegl(inp, type) {
    const fd = new FormData(); fd.append("fichier", inp.files[0]); fd.append("type", type);
    try {
      const rows = await api("/api/import/reglements", { method: "POST", body: fd });
      this.d.reglements = (this.d.reglements || []).concat(rows);
      await this.save(["reglements"], true); toast(rows.length + " ligne(s) importée(s)"); this.v_reglements();
    } catch (e) { alert(e.message); }
    inp.value = "";
  },

  // ------------------------------------------------------- saisie en liste (passage, bordereau, toute page)
  async v_passage() {
    await this.listView("passage1", "Tableau de passage du résultat comptable au résultat fiscal (page 73)", "Chaque ligne est modifiable à tout moment : saisissez un montant pour remplacer le calcul, « Rétablir » revient au calcul automatique. Les totaux, le résultat fiscal, l'IMF/ISB, le traitement des déficits et le bordereau (page 86) se recalculent aussitôt.");
    const p = this.d.params;
    const F = (k, l) => `<div class="f"><label>${l}</label><input class="n" value="${esc(p[k] ?? "")}" placeholder="0" oninput="App.setAcompte('${k}',this.value)"></div>`;
    $("#lv").insertAdjacentHTML("beforebegin", `<div class="card"><h2 style="margin-top:0">Calcul de l'impôt – acomptes et imputations (lignes 53 à 62)</h2>
      <div class="grid-form">${F("acompte1", "1er acompte provisionnel versé")}${F("acompte2", "2e acompte provisionnel versé")}${F("acompte3", "3e acompte provisionnel versé")}
      ${F("credit_impot", "Crédit d'impôt")}${F("precomptes", "Précomptes ISB (2 % / 3 %)")}</div>
      <p class="help">Ces montants alimentent les lignes « 1er, 2e, 3e acompte, crédit d'impôt, précompte » du tableau de passage et les lignes correspondantes du bordereau de versement (page 86). Saisis ici, ils priment sur le registre des acomptes.</p>
      <div id="impot-recap" class="muted" style="margin-top:10px">Calcul…</div></div>`);
    this.refreshImpot();
  },
  setAcompte(k, v) {
    this.d.params[k] = v;
    this.d.params[k + "_manuel"] = String(v).trim() !== "";
    this.save(["params"]).then(() => { this.refreshImpot(); if (this.view === "passage") this.renderList("passage1", "#lv"); }).catch(() => {});
  },
  v_bordereau() { this.listView("bordereau", "Bordereau de versement (IMF/ISB, TAP, TCFGE)", "Montants du bordereau, modifiables à tout moment. Les acomptes et précomptes proviennent du registre ; la TAP et la TCFGE de leurs déclarations."); },
  async listView(pid, titre, aide) {
    $("#main").innerHTML = `<h1>${esc(titre)}</h1><p class="sub">${esc(aide)}</p>
      <div class="row" style="margin-bottom:10px"><button class="btn" onclick="App._page='${pid}';App.go('pages')">Voir la page</button>
      <button class="btn danger" onclick="App.resetPage('${pid}')">Rétablir tous les calculs de la page</button></div><div id="lv">Chargement…</div>`;
    this.renderList(pid, "#lv");
  },
  async renderList(pid, sel) {
    const rows = await api(`/api/dossiers/${this.id}/page/${pid}/liste`);
    $(sel).innerHTML = rows.length ? `<div class="card" style="padding:0"><table class="t"><thead><tr><th>Libellé</th><th>Colonne</th><th>Cellule</th><th class="n">Valeur</th><th style="width:200px">Nouvelle valeur</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.libelle)}</td><td class="muted">${esc(r.colonne || "")}</td><td class="muted">${esc(r.cellule)} ${r.saisie ? '<span class="tag warn">saisi</span>' : r.calcul ? '<span class="tag info">calcul</span>' : ""}</td>
        <td class="n">${esc(r.affiche)}</td>
        <td><input class="n" placeholder="${r.calcul && !r.saisie ? "remplacer le calcul" : "saisir"}" onchange="App.setCell('${esc(r.ref)}',this.value,'${pid}','${sel}')"></td>
        <td>${r.saisie ? `<button class="btn sm" onclick="App.setCell('${esc(r.ref)}','__reset__','${pid}','${sel}')">Rétablir</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="vide">Cette page se modifie directement dans la visionneuse.</div>`;
  },
  async setCell(ref, value, pid, sel) {
    await this.flush();
    const r = await api(`/api/dossiers/${this.id}/cellule`, { json: { ref, value } });
    toast("Enregistré – calculs mis à jour");
    if (r.parametre) { this.d.params = (await api(`/api/dossiers/${this.id}`)).params || {}; if (this.view === "passage") return this.v_passage(); }
    this.renderList(pid, sel); this.synthese();
  },
  async resetPage(pid) {
    if (!confirm("Supprimer toutes les saisies de cette page et revenir aux calculs automatiques ?")) return;
    const r = await api(`/api/dossiers/${this.id}/page/${pid}/reinitialiser`, { method: "POST" });
    toast(r.supprimees + " saisie(s) supprimée(s)");
    this.d = await api(`/api/dossiers/${this.id}`);
    if (this.view === "pages") this.showPage(pid); else this.go(this.view);
  },

  async v_controles() {
    $("#main").innerHTML = `<h1>Contrôles de cohérence</h1><p class="sub">Rapprochements entre la balance, les états financiers, les notes annexes, le tableau des immobilisations et les états fiscaux. Un écart signale une donnée manquante ou une anomalie de ventilation.</p><div id="ck">Calcul…</div>`;
    const s = await this.synthese();
    $("#ck").innerHTML = `<div class="card" style="padding:0"><table class="t checks"><thead><tr><th></th><th>Contrôle</th><th class="n">Valeur</th><th class="n">Attendu</th><th class="n">Écart</th></tr></thead><tbody>
      ${s.controles.map((c) => `<tr><td>${c.ok ? '<span class="tag ok">OK</span>' : '<span class="tag ko">Écart</span>'}</td><td>${esc(c.libelle)}</td><td class="n">${fmt(c.a)}</td><td class="n">${fmt(c.b)}</td><td class="n ${c.ok ? "" : "neg"}">${fmt(c.a - c.b)}</td></tr>`).join("")}
      </tbody></table></div>`;
  },

  // ------------------------------------------------------- societe
  v_societe() {
    const i = this.d.identite, e = this.d.exercice;
    const F = (obj, k, l, type = "text", ph = "") => `<div class="f"><label>${l}</label><input type="${type}" value="${esc(obj[k] ?? "")}" placeholder="${ph}" oninput="App.set('${obj === e ? "exercice" : "identite"}','${k}',this.value)"></div>`;
    const acts = this.d.activites;
    while (acts.length < 3) acts.push({});
    $("#main").innerHTML = `<h1>Société et exercice</h1>
      <p class="sub">Ces informations alimentent la page de garde, les fiches R1 à R3 et l'en-tête de toutes les pages. Les autres rubriques des fiches (dirigeants, associés, domiciliations bancaires…) se saisissent directement dans la page concernée (menu « Pages de la liasse »).</p>
      <div class="card"><h2 style="margin-top:0">Identification</h2><div class="grid-form">
        ${F(i, "denomination", "Dénomination sociale")}${F(i, "sigle", "Sigle usuel")}${F(i, "nif", "NIF")}${F(i, "ntd", "N° télédéclarant (NTD)")}
        ${F(i, "adresse", "Adresse (quartier, ville)")}${F(i, "adresse_complete", "Adresse géographique complète (fiche R1)")}${F(i, "bp", "Boîte postale")}${F(i, "ville", "Ville")}
        ${F(i, "telephone", "Téléphone")}${F(i, "email", "Email")}${F(i, "greffe", "Greffe (RCCM)")}${F(i, "rccm", "N° registre du commerce")}
        ${F(i, "repertoire", "N° répertoire des entités")}${F(i, "cnss", "N° CNSS employeur")}${F(i, "code_importateur", "N° code importateur")}${F(i, "code_activite", "Code activité principale", "text", "Ex. : 041 001")}
        ${F(i, "activite", "Activité principale exercée")}${F(i, "capacite", "% capacité de production utile")}
      </div></div>
      <div class="card"><h2 style="margin-top:0">Codes (fiche R2)</h2><div class="grid-form">
        ${F(i, "forme_juridique", "Forme juridique (2 chiffres)", "text", "SA 02, SARL 03, SARLU 03…")}${F(i, "regime_fiscal", "Régime fiscal", "text", "1 réel normal, 2 simplifié")}
        ${F(i, "pays_siege", "Pays du siège (2 chiffres)", "text", "Niger 06")}${F(i, "nb_etab_pays", "Établissements dans le pays")}
        ${F(i, "nb_etab_hors", "Établissements hors du pays")}${F(i, "premiere_annee", "Première année d'exercice (4 chiffres, ex. 2015)")}
      </div><p class="help">Les codes suivent la table des codes de la liasse (page 3).</p></div>
      <div class="card"><h2 style="margin-top:0">Exercice</h2><div class="grid-form">
        ${F(e, "annee", "Exercice (année)", "number")}${F(e, "debut", "Début", "date")}${F(e, "fin", "Clôture", "date")}${F(e, "duree", "Durée (mois)", "number")}
        ${F(e, "date_arrete", "Date d'arrêté des comptes", "date")}${F(e, "prec_fin", "Exercice précédent clos le", "date")}${F(e, "prec_duree", "Durée exercice précédent", "number")}
      </div></div>
      <div class="card"><h2 style="margin-top:0">Responsables et signature</h2><div class="grid-form">
        ${F(i, "contact", "Personne à contacter (nom, tél., email, qualité)")}${F(i, "comptable", "Professionnel comptable ayant établi les états")}
        ${F(i, "expert_visa", "Expert-comptable (attestation de visa)")}${F(i, "cac", "Commissaire aux comptes")}
        ${F(i, "signataire", "Signataire des états financiers")}${F(i, "qualite_signataire", "Qualité du signataire")}${F(i, "date_signature", "Date de signature", "date")}
      </div></div>
      <div class="card"><h2 style="margin-top:0">Activités (fiche R2)</h2>
        <p class="help">Laissez le chiffre d'affaires vide pour la répartition automatique (ventes de marchandises sur la 1re ligne, autres ventes sur la 2e).</p>
        <table class="t"><thead><tr><th>Désignation de l'activité</th><th>Code nomenclature</th><th class="n">Chiffre d'affaires HT</th><th></th></tr></thead><tbody id="acts"></tbody></table>
        <button class="btn sm" style="margin-top:8px" onclick="App.d.activites.push({});App.v_societe()">+ Ligne</button></div>`;
    $("#acts").innerHTML = acts.map((a, n) => `<tr><td><input value="${esc(a.designation || "")}" oninput="App.d.activites[${n}].designation=this.value;App.save()"></td>
      <td><input value="${esc(a.code || "")}" oninput="App.d.activites[${n}].code=this.value;App.save()"></td>
      <td><input class="n" value="${a.ca ?? ""}" oninput="App.d.activites[${n}].ca=this.value;App.save()"></td>
      <td><button class="btn sm danger" onclick="App.d.activites.splice(${n},1);App.save();App.v_societe()">×</button></td></tr>`).join("");
  },
  set(group, key, val) {
    this.d[group][key] = val;
    const pr = this.save();
    if (group === "params" && this.view === "fiscal") pr.then(() => this.refreshImpot()).catch(() => {});
  },
  async refreshImpot() {
    const box = $("#impot-recap");
    if (!box) return;
    const r = await api(`/api/dossiers/${this.id}/impot`);
    box.classList.remove("muted");
    const pc = (x) => (Number(x || 0) * 100).toFixed(2).replace(/\.?0+$/, "").replace(".", ",") + " %";
    const L = (l, v, cls = "") => `<tr class="${cls}"><td>${l}</td><td class="n">${fmt(v)}</td></tr>`;
    box.innerHTML = `<div class="row" style="align-items:flex-start;gap:18px">
      <table class="t flex1"><tbody>
        ${L(`IMF : ${fmt(r.ca)} × ${pc(r.taux_imf)}`, r.imf)}
        ${r.minimum ? L("Minimum de perception", r.minimum) : ""}
        ${L(`ISB : ${fmt(r.base_isb)} × ${pc(r.taux_isb)}`, r.isb)}
        ${L(`<b>Impôt dû${r.nature ? " (" + r.nature + ")" : ""}</b>`, r.impot_du, "tot")}
        ${r.deductions.map(([l, v]) => L("− " + l, v)).join("")}
        ${L("<b>Total des déductions</b>", r.total_deductions, "tot")}
        ${L(r.credit ? (r.impute ? "<b>Excédent versé (imputé au bordereau)</b>" : "<b>Excédent versé (crédit reportable)</b>") : "<b>Solde IMF / ISB à payer</b>", r.credit || r.a_payer, "tot")}
      </tbody></table>
      <table class="t flex1"><tbody>
        ${L(r.solde < 0 ? "Solde IMF / ISB (excédent)" : "Solde IMF / ISB", r.impute ? r.solde : r.a_payer)}
        ${r.tap_mode === "base" ? L("Base TAP brute", r.tap_base) + (r.tap_ded_base ? L("− Frais de formation (déduits de la base)", r.tap_ded_base) : "") + L("Base TAP nette", r.tap_base_nette)
          : L("TAP brute (3 % / 5 %)", r.tap_brute) + (r.tap_formation ? L("− Déduction frais de formation", r.tap_formation) : "")}
        ${L("TAP nette", r.tap)}${L("TCFGE", r.tcfge)}
        ${L("<b>Total à payer (bordereau)</b>", r.total, "tot")}
        ${r.credit_reportable ? L("Crédit reportable", r.credit_reportable) : ""}
      </tbody></table></div>
      <p class="help">Total à payer = impôt dû (ISB ou IMF) − 3 acomptes − crédit d'impôt − précomptes + TAP nette + TCFGE${r.impute ? " ; l'excédent éventuel d'ISB/IMF vient en déduction de la TAP et de la TCFGE." : " ; l'excédent éventuel d'ISB/IMF est reporté en crédit, sans imputation sur la TAP."}</p>
      ${r.illisibles.length ? `<p class="help" style="color:var(--ko)">Montant(s) illisible(s), comptés pour 0 : ${r.illisibles.map((x) => esc(x[1])).join(", ")}</p>` : ""}
      ${r.registre ? `<p class="help">Le registre « Acomptes et précomptes » est renseigné : ses totaux s'appliquent aux natures qu'il contient, sauf pour les montants saisis directement ici ou sur les pages 73 et 86.</p>` : ""}`;
  },

  // ------------------------------------------------------- balances
  v_balance_n() { this.balanceView("n"); },
  v_balance_n1() { this.balanceView("n1"); },
  balanceView(which) {
    const key = "balance_" + which, lab = which === "n" ? "N" : "N-1";
    const b = this.d[key];
    const sd = b.reduce((a, x) => a + num(x.sd), 0), sc = b.reduce((a, x) => a + num(x.sc), 0);
    $("#main").innerHTML = `<h1>Balance ${lab}</h1>
      <p class="sub">${which === "n" ? "Balance générale de l'exercice, <b>avant affectation du résultat</b> (classes 1 à 8, soldes finaux). Les comptes 13 éventuels (résultat N-1 non affecté) sont rattachés au report à nouveau." :
        "Balance de l'exercice précédent : elle alimente la colonne N-1 des états. Elle est reprise automatiquement lors de l'ouverture de l'exercice suivant."}
      Formats acceptés : Excel (.xlsx, .xls) ou CSV, avec les colonnes compte, intitulé et soldes débit/crédit (ou solde unique signé).</p>
      <div class="card"><div class="row">
        <label class="btn primary">Importer un fichier<input type="file" accept=".xlsx,.xls,.xlsm,.csv,.txt" class="hidden" onchange="App.importBalance(this,'${which}')"></label>
        ${b.length ? `<button class="btn danger" onclick="App.clearBalance('${which}')">Vider</button>` : ""}
        <span class="flex1"></span>
        ${b.length ? `<span>${b.length} comptes</span><span class="tag ${Math.abs(sd - sc) < 1 ? "ok" : "ko"}">Débit ${fmt(sd)} · Crédit ${fmt(sc)}</span>` : `<span class="muted">Aucune balance importée</span>`}
      </div></div>
      ${b.length ? `<div class="row" style="margin-bottom:8px"><input id="bq" placeholder="Rechercher un compte ou un intitulé…" style="max-width:340px" oninput="App.filterBal('${which}')"></div>
      <div class="scroll"><table class="t"><thead><tr><th>Compte</th><th>Intitulé</th><th class="n">Solde débiteur</th><th class="n">Solde créditeur</th></tr></thead><tbody id="btb"></tbody>
      <tfoot><tr><td></td><td>Total</td><td class="n">${fmt(sd)}</td><td class="n">${fmt(sc)}</td></tr></tfoot></table></div>` : ""}`;
    if (b.length) this.filterBal(which);
  },
  filterBal(which) {
    const q = ($("#bq").value || "").toLowerCase();
    const rows = this.d["balance_" + which].filter((x) => !q || x.compte.includes(q) || (x.intitule || "").toLowerCase().includes(q));
    $("#btb").innerHTML = rows.slice(0, 3000).map((x) => `<tr><td>${esc(x.compte)}</td><td>${esc(x.intitule)}</td><td class="n">${fmt(x.sd)}</td><td class="n">${fmt(x.sc)}</td></tr>`).join("");
  },
  async clearBalance(which) {
    if (!confirm("Vider cette balance ?")) return;
    this.d["balance_" + which] = [];
    await api(`/api/dossiers/${this.id}`, { method: "PUT", json: { ["balance_" + which]: [] } });
    this.go(this.view);
  },
  async importBalance(inp, which) {
    const file = inp.files[0]; if (!file) return;
    const fd = new FormData(); fd.append("fichier", file);
    let info;
    try { info = await api("/api/import/analyse", { method: "POST", body: fd }); } catch (e) { alert(e.message); return; }
    this._import = { file, which, info };
    const opts = (sel) => `<option value="">—</option>` + info.headers.map((h, j) => `<option value="${j}" ${sel === j ? "selected" : ""}>${j + 1}. ${esc(h || "Colonne " + (j + 1))}</option>`).join("");
    const m = info.mapping;
    const pv = info.preview.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("");
    modal(`<h2 style="margin-top:0">Import de la balance ${which === "n" ? "N" : "N-1"} – ${esc(file.name)}</h2>
      <p class="help">Vérifiez l'affectation des colonnes proposée. Utilisez « Solde signé » si le fichier ne comporte qu'une colonne de solde (débiteur positif, créditeur négatif). Les comptes de totalisation (préfixes d'autres comptes) sont ignorés automatiquement.</p>
      <div class="grid-form">
        <div class="f"><label>Numéro de compte</label><select id="m-compte">${opts(m.compte)}</select></div>
        <div class="f"><label>Intitulé</label><select id="m-intitule">${opts(m.intitule)}</select></div>
        <div class="f"><label>Solde débiteur</label><select id="m-debit">${opts(m.debit)}</select></div>
        <div class="f"><label>Solde créditeur</label><select id="m-credit">${opts(m.credit)}</select></div>
        <div class="f"><label>ou Solde signé</label><select id="m-solde">${opts(m.solde)}</select></div>
      </div>
      <h2>Aperçu</h2><div class="scroll" style="max-height:260px"><table class="t"><thead><tr>${info.headers.map((h, j) => `<th>${j + 1}. ${esc(h)}</th>`).join("")}</tr></thead><tbody>${pv}</tbody></table></div>
      <div class="row" style="margin-top:14px"><button class="btn primary" onclick="App.doImport()">Importer</button><button class="btn" onclick="closeModal()">Annuler</button></div>`);
    inp.value = "";
  },
  async doImport() {
    const { file, which, info } = this._import;
    const g = (id) => { const v = $("#m-" + id).value; return v === "" ? null : +v; };
    const mapping = { compte: g("compte"), intitule: g("intitule"), debit: g("debit"), credit: g("credit"), solde: g("solde") };
    if (mapping.solde !== null) { mapping.debit = null; mapping.credit = null; }
    const fd = new FormData(); fd.append("fichier", file); fd.append("mapping", JSON.stringify(mapping)); fd.append("header_row", info.header_row ?? "");
    const r = await api(`/api/dossiers/${this.id}/balance/${which}`, { method: "POST", body: fd });
    closeModal();
    toast(`${r.comptes} comptes importés – débit ${fmt(r.debit)} / crédit ${fmt(r.credit)}`, 4000);
    this.d = await api(`/api/dossiers/${this.id}`);
    this.go(which === "n" ? "balance_n" : "balance_n1");
  },

  // ------------------------------------------------------- ventilation
  async v_ventilation() {
    $("#main").innerHTML = `<h1>Ventilation des comptes</h1>
      <p class="sub">Chaque compte de la balance est rattaché à une ligne du plan SYSCOHADA révisé (préfixe le plus long), qui alimente un poste du bilan ou du compte de résultat. La colonne « Poste attendu » donne le poste prévu par le plan pour ce compte et le sens de son solde (un fournisseur débiteur va en BH, un client créditeur en DI, une banque créditrice en DR…) : tout écart est signalé « à vérifier ». Choisissez au besoin la ligne cible avec « Modifier ».</p>
      <div class="row" style="margin-bottom:10px"><select id="vf" style="max-width:240px" onchange="App.renderVent()"><option value="check">À vérifier</option><option value="all">Tous les comptes</option></select>
      <input id="vq" placeholder="Rechercher…" style="max-width:300px" oninput="App.renderVent()"></div><div id="vt">Chargement…</div>`;
    if (!this.leaf) this.leaf = await api("/api/lignes-standard");
    this._vent = await api(`/api/dossiers/${this.id}/ventilation`);
    this.renderVent();
  },
  renderVent() {
    const f = $("#vf").value, q = ($("#vq").value || "").toLowerCase();
    let rows = this._vent;
    if (f === "check") rows = rows.filter((x) => x.mode !== "auto" || x.statut !== "conforme");
    if (q) rows = rows.filter((x) => x.compte.includes(q) || (x.intitule || "").toLowerCase().includes(q) || (x.poste || "").toLowerCase() === q);
    const tag = { auto: "", approx: '<span class="tag warn">approximation</span>', manuel: '<span class="tag info">manuel</span>', "non ventilé": '<span class="tag ko">non ventilé</span>' };
    const st = { conforme: '<span class="tag ok">conforme</span>', "à vérifier": '<span class="tag ko">à vérifier</span>', "solde inversé": '<span class="tag warn">solde inversé</span>', "non ventilé": '<span class="tag ko">non ventilé</span>' };
    const nb = (k) => this._vent.filter((x) => x.statut === k).length;
    $("#vt").innerHTML = `<p class="muted">${this._vent.length} comptes : ${nb("conforme")} conformes au plan SYSCOHADA, ${nb("à vérifier")} à vérifier, ${nb("solde inversé")} à solde inversé, ${nb("non ventilé")} non ventilé(s).</p>` + (rows.length ? `<div class="scroll"><table class="t"><thead><tr><th>Bal.</th><th>Compte</th><th>Intitulé</th><th class="n">Solde</th><th>Poste retenu</th><th>Poste attendu</th><th>Ligne du plan SYSCOHADA</th><th>Contrôle</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 1500).map((x) => `<tr><td>${x.source}</td><td>${esc(x.compte)}</td><td>${esc(x.intitule)}</td><td class="n">${fmt(num(x.sd) - num(x.sc))}</td>
        <td title="${esc(x.poste_lib)}"><b>${esc(x.poste)}</b> <span class="muted">${esc((x.poste_lib || "").slice(0, 32))}</span></td>
        <td title="${esc(x.attendu_lib)}">${x.attendu && x.attendu !== x.poste ? `<b style="color:var(--ko)">${esc(x.attendu)}</b> <span class="muted">${esc((x.attendu_lib || "").slice(0, 32))}</span>` : `<span class="muted">${esc(x.attendu || "")}</span>`}</td>
        <td>${x.ligne ? esc(x.compte_std + " – " + x.libelle_std) : ""} ${tag[x.mode] || ""}</td><td>${st[x.statut] || ""}</td>
        <td><button class="btn sm" onclick="App.pickLine('${esc(x.compte)}')">Modifier</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="vide">${f === "check" ? "Aucun compte à vérifier : chaque compte alimente le poste prévu par le plan SYSCOHADA." : "Aucun compte."}</div>`);
  },
  pickLine(compte) {
    modal(`<h2 style="margin-top:0">Rattacher le compte ${esc(compte)}</h2>
      <input id="lq" placeholder="Rechercher un numéro ou un libellé du plan (ex. 6222, loyers)…" oninput="App.renderLeaf('${compte}')">
      <div class="scroll" style="margin-top:10px;max-height:50vh"><table class="t"><tbody id="ltb"></tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn" onclick="App.setLine('${compte}',null)">Revenir à la ventilation automatique</button><button class="btn" onclick="closeModal()">Fermer</button></div>`);
    this.renderLeaf(compte);
    setTimeout(() => $("#lq").focus(), 50);
  },
  renderLeaf(compte) {
    const q = ($("#lq").value || "").toLowerCase();
    const rows = this.leaf.filter((x) => !q || x.compte.startsWith(q) || x.libelle.toLowerCase().includes(q)).slice(0, 300);
    $("#ltb").innerHTML = rows.map((x) => `<tr><td>${esc(x.compte)}</td><td>${esc(x.libelle)}</td><td><b>${esc(x.poste)}</b></td><td><button class="btn sm primary" onclick="App.setLine('${compte}',${x.ligne})">Choisir</button></td></tr>`).join("");
  },
  async setLine(compte, ligne) {
    if (ligne) this.d.mapping[compte] = ligne; else delete this.d.mapping[compte];
    await this.save(["mapping"], true);
    closeModal(); this._vent = await api(`/api/dossiers/${this.id}/ventilation`); this.renderVent(); this.synthese();
  },

  // ------------------------------------------------------- immobilisations
  async v_immo() {
    const P = { AE: "Frais de développement", AF: "Brevets, logiciels", AG: "Fonds commercial", AH: "Autres incorporelles", AJ: "Terrains", AK: "Bâtiments", AL: "Aménagements, installations", AM: "Matériel, mobilier", AN: "Matériel de transport", AP: "Avances et acomptes", AR: "Titres de participation", AS: "Autres immob. financières" };
    this._postes = P;
    $("#main").innerHTML = `<h1>Immobilisations et amortissements</h1>
      <p class="sub">Le tableau alimente les notes 3A (acquisitions, cessions), 3C (dotations, sorties), 3D (plus ou moins-values) et l'état complémentaire n°9. Amortissement linéaire, prorata temporis sur 360 jours. Si les amortissements antérieurs ne sont pas renseignés, ils sont recalculés depuis la date de mise en service. Au-delà de 14 biens, l'état n°9 présente les totaux par poste et le détail complet est joint en annexe.</p>
      <div class="row" style="margin-bottom:10px">
        <button class="btn primary" onclick="App.addImmo()">+ Bien</button>
        <label class="btn">Importer un tableau Excel<input type="file" accept=".xlsx,.xls,.csv" class="hidden" onchange="App.importImmo(this)"></label>
        <label class="row" style="gap:6px"><input type="checkbox" ${this.d.options.immo_notes !== false ? "checked" : ""} onchange="App.d.options.immo_notes=this.checked;App.save()"> Utiliser ce tableau pour les notes 3A, 3C et 3D</label>
      </div>
      <div class="scroll" style="max-height:none"><table class="t" id="imt"><thead><tr><th style="min-width:180px">Désignation</th><th>Réf.</th><th>Compte</th><th>Poste</th><th>Date acquisition</th><th>Mise en service</th>
        <th class="n">Valeur d'origine</th><th class="n">Taux %</th><th class="n">Amort. antérieurs</th><th>Date cession</th><th class="n">Prix cession</th>
        <th class="n">Dotation</th><th class="n">Cumul</th><th class="n">VNC</th><th></th></tr></thead><tbody id="imb"></tbody><tfoot id="imf"></tfoot></table></div>`;
    this.renderImmo();
  },
  renderImmo() {
    const P = this._postes;
    const opt = (v) => Object.entries(P).map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${k} – ${l}</option>`).join("");
    const I = (n, k, cls = "", type = "text") => `<input class="${cls}" type="${type}" value="${esc(this.d.immobilisations[n][k] ?? "")}" onchange="App.immoSet(${n},'${k}',this.value)">`;
    $("#imb").innerHTML = this.d.immobilisations.map((a, n) => `<tr>
      <td>${I(n, "designation")}</td><td style="width:80px">${I(n, "reference")}</td><td style="width:80px">${I(n, "compte")}</td>
      <td><select onchange="App.immoSet(${n},'poste',this.value)"><option value="">auto</option>${opt(a.poste)}</select></td>
      <td>${I(n, "date_acquisition", "", "date")}</td><td>${I(n, "date_service", "", "date")}</td>
      <td style="width:110px">${I(n, "valeur", "n")}</td><td style="width:60px">${I(n, "taux", "n")}</td><td style="width:110px">${I(n, "amort_anterieur", "n")}</td>
      <td>${I(n, "date_cession", "", "date")}</td><td style="width:100px">${I(n, "prix_cession", "n")}</td>
      <td class="n" id="im-d${n}"></td><td class="n" id="im-c${n}"></td><td class="n" id="im-v${n}"></td>
      <td><button class="btn sm danger" onclick="App.d.immobilisations.splice(${n},1);App.save().then(()=>App.renderImmo())">×</button></td></tr>`).join("")
      || `<tr><td colspan="15" class="muted" style="padding:18px">Aucun bien. Ajoutez les biens un par un ou importez votre tableau d'amortissement (colonnes : désignation, compte, date d'acquisition, valeur, taux, amortissements antérieurs…).</td></tr>`;
    this.calcImmo();
  },
  immoSet(n, k, v) { this.d.immobilisations[n][k] = v; this.save().then(() => this.calcImmo()); },
  addImmo() { this.d.immobilisations.push({ designation: "", taux: "", valeur: "" }); this.renderImmo(); },
  async calcImmo() {
    await this.save(["immobilisations", "options"], true);
    const r = await api(`/api/dossiers/${this.id}/immobilisations/calcul`);
    let t = { v: 0, d: 0, c: 0, n: 0 };
    r.lignes.forEach((l, n) => {
      if (!l) return;
      $("#im-d" + n) && ($("#im-d" + n).textContent = fmt(l.dotation));
      $("#im-c" + n) && ($("#im-c" + n).textContent = fmt(l.cum_clot));
      $("#im-v" + n) && ($("#im-v" + n).textContent = fmt(l.clot_brut - l.cum_clot));
      t.v += l.clot_brut; t.d += l.dotation; t.c += l.cum_clot;
    });
    $("#imf").innerHTML = `<tr><td colspan="6">Total (biens présents à la clôture)</td><td class="n">${fmt(t.v)}</td><td></td><td></td><td></td><td></td><td class="n">${fmt(t.d)}</td><td class="n">${fmt(t.c)}</td><td class="n">${fmt(t.v - t.c)}</td><td></td></tr>`;
  },
  async importImmo(inp) {
    const fd = new FormData(); fd.append("fichier", inp.files[0]);
    try {
      const items = await api("/api/import/immobilisations", { method: "POST", body: fd });
      if (this.d.immobilisations.length && !confirm(`${items.length} biens lus. Remplacer le tableau actuel ? (Annuler = ajouter à la suite)`)) this.d.immobilisations.push(...items);
      else this.d.immobilisations = items;
      await this.save(["immobilisations"], true); this.renderImmo(); toast(items.length + " biens importés");
    } catch (e) { alert(e.message); }
    inp.value = "";
  },

  // ------------------------------------------------------- fiscalite
  v_fiscal() {
    const p = this.d.params;
    const ACQ = ["acompte1", "acompte2", "acompte3", "precomptes", "credit_impot"];
    const F = (k, l, ph = "", help = "") => `<div class="f"><label>${l}</label><input value="${esc(p[k] ?? "")}" placeholder="${ph}" oninput="${ACQ.includes(k) ? `App.setAcompte('${k}',this.value)` : `App.set('params','${k}',this.value)`}">${help ? `<div class="help">${help}</div>` : ""}</div>`;
    $("#main").innerHTML = `<h1>IMF / ISB, acomptes et déficits</h1>
      <p class="sub">Paramètres du tableau de passage (état n°3), du traitement des déficits (état n°4) et du bordereau de versement (état n°13). Les montants se saisissent en francs CFA. Lors de l'ouverture de l'exercice suivant, les déficits, les ARD et la TAP à déduire sont repris automatiquement.</p>
      <div class="card"><h2 style="margin-top:0">Calcul de l'impôt et bordereau de versement</h2><div id="impot-recap" class="muted">Calcul…</div></div>
      <div class="card"><h2 style="margin-top:0">Impôt sur le résultat</h2><div class="grid-form">
        <div class="f"><label>Taux de l'IMF (appliqué au chiffre d'affaires)</label><select onchange="App.set('params','taux_imf',this.value)">
          ${[["0.01", "1 %"], ["0.0175", "1,75 %"], ["0.03", "3 %"]].map(([v, l]) => `<option value="${v}" ${String(p.taux_imf ?? "0.0175") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        ${F("taux_isb", "Taux de l'ISB", "0.30")}${F("imf_minimum", "Minimum de perception IMF (le cas échéant)", "0")}
        <p class="muted" style="grid-column:1/-1;margin:0">Minimum de perception : montant à vérifier dans le CGI en vigueur pour l'exercice et à saisir ici (0 = aucun minimum). Il est repris d'un exercice à l'autre. Ne pas le confondre avec le minimum de la taxe professionnelle.</p>
      </div></div>
      <div class="card"><h2 style="margin-top:0">Acomptes, précomptes et crédits</h2><div class="grid-form">
        ${F("acompte1", "1er acompte versé")}${F("acompte2", "2e acompte versé")}${F("acompte3", "3e acompte versé")}
        ${F("precomptes", "Précomptes ISB subis (2 %, 3 %…)")}${F("credit_impot", "Crédit d'impôt imputable")}
        <div class="f"><label>Excédent d'ISB / IMF (acomptes supérieurs à l'impôt)</label><select onchange="App.set('params','imputer_credit',this.value==='1')">
          <option value="1" ${p.imputer_credit !== false ? "selected" : ""}>Imputé sur la TAP et la TCFGE du bordereau</option>
          <option value="0" ${p.imputer_credit === false ? "selected" : ""}>Reporté en crédit d'impôt (non imputé)</option></select></div>
      </div><p class="help">${(App.d.reglements || []).length ? "Le registre « Acomptes et précomptes » est renseigné : ses totaux s'appliquent aux natures qu'il contient, sauf pour les montants saisis ici ou sur les pages 73 et 86." : "Pour justifier ces montants ligne par ligne (quittances, relevés de douane, relevés bancaires, attestations de retenue), utilisez l'écran « Acomptes et précomptes »."} <a href="#" onclick="App.go('reglements');return false">Ouvrir le registre</a></p></div>
      <div class="card"><h2 style="margin-top:0">Réintégrations et déductions</h2><div class="grid-form">
        ${F("factures_sans_nif", "Charges sur factures sans NIF (à réintégrer)")}
        <div class="f"><label>TAP de l'exercice à réintégrer</label><select onchange="App.set('params','tap_reintegrer',this.value==='1')">
          <option value="1" ${p.tap_reintegrer !== false ? "selected" : ""}>Oui, montant de la déclaration TAP</option><option value="0" ${p.tap_reintegrer === false ? "selected" : ""}>Non / montant saisi</option></select></div>
        ${F("tap_reintegree_saisie", "TAP réintégrée (si saisie manuelle)")}
        ${F("tap_n1", "TAP N-1 à déduire (payée dans l'exercice)")}
        ${F("conges_n", "Congés payés de l'exercice (réintégrés)")}${F("conges_n1", "Congés payés N-1 (déduits)")}
      </div><p class="help">Les autres lignes du tableau de passage (amortissements non déductibles, amendes, dons, provisions…) se saisissent directement dans la page « Tableau de passage (73) ». Les amendes et pénalités (comptes 647) sont réintégrées automatiquement.</p></div>
      <div class="card"><h2 style="margin-top:0">Déficits reportables et amortissements réputés différés</h2>
        <table class="t" style="max-width:760px"><thead><tr><th>Exercice</th><th>Année</th><th class="n">Déficit d'origine</th><th class="n">Déjà imputé</th></tr></thead><tbody>
        ${["N-3", "N-2", "N-1"].map((l, i) => `<tr><td>${l}</td><td><input value="${esc(p["deficit_annee_" + i] ?? "")}" oninput="App.set('params','deficit_annee_${i}',this.value)"></td>
          <td><input class="n" value="${esc(p["deficit_orig_" + i] ?? "")}" oninput="App.set('params','deficit_orig_${i}',this.value)"></td>
          <td><input class="n" value="${esc(p["deficit_impute_" + i] ?? "")}" oninput="App.set('params','deficit_impute_${i}',this.value)"></td></tr>`).join("")}
        </tbody></table>
        <div class="grid-form" style="margin-top:12px">${F("ard_anterieurs", "Amortissements réputés différés reportables (antérieurs)")}</div>
        <p class="help">Les déficits sont imputables sur les trois exercices suivants (CGI, art. 24) ; les amortissements réputés différés en période déficitaire sont reportables sans limitation de délai (art. 12).</p></div>
      <div class="card"><h2 style="margin-top:0">Dépôt</h2><div class="grid-form">${F("nb_exemplaires", "Nombre d'exemplaires déposés", "4")}</div></div>`;
    this.refreshImpot();
  },

  // ------------------------------------------------------- TAP / TCFGE
  async v_tap() {
    const t = this.d.tap; t.lignes = t.lignes || {}; t.formation = t.formation || {}; t.apprentis = t.apprentis || [];
    const r = await api(`/api/dossiers/${this.id}/declarations`);
    const T = r.tap;
    $("#main").innerHTML = `<h1>Taxe d'apprentissage (TAP)</h1>
      <p class="sub">Assiette : rémunérations versées au cours de l'exercice. Par défaut, les montants sont lus dans la balance (comptes indiqués) ; saisissez un montant pour le forcer. Taux : 3 % (travailleurs nigériens) et 5 % (travailleurs non nigériens). Par défaut, les frais de formation sont déduits de la base avant application du taux (option modifiable plus bas).</p>
      <div class="card" style="padding:0"><table class="t"><thead><tr><th>Ligne</th><th>Libellé</th><th>Comptes (préfixes séparés par ;)</th><th class="n">Montant forcé</th><th class="n">Montant retenu</th></tr></thead><tbody>
      ${r.tap_lignes.map(([c, l, def]) => { const L = t.lignes[c] || {}; return `<tr><td><b>${c}</b></td><td>${esc(l)}</td>
        <td><input value="${esc(L.comptes ?? def)}" onchange="App.tapSet('${c}','comptes',this.value)"></td>
        <td style="width:140px"><input class="n" value="${esc(L.montant ?? "")}" onchange="App.tapSet('${c}','montant',this.value)"></td>
        <td class="n">${fmt(T.vals[c])}</td></tr>`; }).join("")}
      </tbody><tfoot><tr><td>K</td><td colspan="3">Total de l'assiette (C + F + G + H + I + J)</td><td class="n">${fmt(T.K)}</td></tr></tfoot></table></div>
      <div class="card"><div class="grid-form">
        <div class="f"><label>Base afférente aux travailleurs non nigériens (5 %)</label><input value="${esc(t.base_etrangers ?? "")}" placeholder="auto : comptes ${esc(t.comptes_etrangers || "662")}" onchange="App.d.tap.base_etrangers=this.value;App.save().then(()=>App.v_tap())"></div>
        <div class="f"><label>Comptes des salaires non nationaux</label><input value="${esc(t.comptes_etrangers ?? "662")}" onchange="App.d.tap.comptes_etrangers=this.value;App.save().then(()=>App.v_tap())"></div>
        <div class="f"><label>FFP (bordereau)</label><input value="${esc(t.ffp ?? "")}" onchange="App.d.tap.ffp=this.value;App.save().then(()=>App.v_tap())"></div>
      </div>
      <h2>Dépenses libératoires (page 2)</h2><div class="grid-form">
        ${[["frais_formation", "A – Frais de formation supportés"], ["salaires_techniciens", "B – Salaires des techniciens formateurs"], ["bourses", "C – Subventions, bourses, allocations d'études"], ["concours", "D – Rémunérations des apprentis sous contrat"]].map(([k, l]) =>
          `<div class="f"><label>${l}</label><input class="n" value="${esc(t.formation[k] ?? "")}" onchange="App.d.tap.formation['${k}']=this.value;App.save().then(()=>App.v_tap())"></div>`).join("")}
      </div>
      <h2>Détail des frais de formation</h2>
      <p class="help">Saisissez ou importez chaque dépense (catégorie A frais de formation, B salaires des formateurs, C bourses et stages, D rémunérations des apprentis, E concours versés à un établissement). Lorsque le détail est renseigné, il remplace les montants globaux ci-dessus et un état des frais est joint à la déclaration.</p>
      <table class="t"><thead><tr><th>Cat.</th><th>Date</th><th>Libellé de l'action</th><th>Organisme / bénéficiaire</th><th>Pièce</th><th class="n">Montant</th><th></th></tr></thead><tbody>
      ${(this.d.formations || []).map((f, n) => `<tr><td><select onchange="App.d.formations[${n}].categorie=this.value;App.save(['formations']).then(()=>App.v_tap())">${["A", "B", "C", "D", "E"].map((c) => `<option ${f.categorie === c ? "selected" : ""}>${c}</option>`).join("")}</select></td>
        ${["date", "libelle", "organisme", "piece", "montant"].map((k) => `<td><input ${k === "montant" ? 'class="n"' : ""} ${k === "date" ? 'type="date"' : ""} value="${esc(f[k] ?? "")}" onchange="App.d.formations[${n}]['${k}']=this.value;App.save(['formations']).then(()=>App.v_tap())"></td>`).join("")}
        <td><button class="btn sm danger" onclick="App.d.formations.splice(${n},1);App.save(['formations']).then(()=>App.v_tap())">×</button></td></tr>`).join("")}
      </tbody></table>
      <div class="row" style="margin-top:8px"><button class="btn sm" onclick="(App.d.formations=App.d.formations||[]).push({categorie:'A'});App.v_tap()">+ Dépense de formation</button>
      <label class="btn sm">Importer (Excel/CSV)<input type="file" accept=".xlsx,.xls,.csv" class="hidden" onchange="App.importForm(this)"></label></div>
      <h2>Résultat</h2>
      <div class="f" style="max-width:640px;margin-bottom:10px"><label>Traitement des frais de formation</label>
        <select onchange="App.d.tap.mode_formation=this.value;App.save(['tap']).then(()=>App.v_tap())">
          <option value="base" ${(t.mode_formation || "base") === "base" ? "selected" : ""}>Déduits de la base, puis taux appliqué à la base nette</option>
          <option value="taxe" ${t.mode_formation === "taxe" ? "selected" : ""}>Déduits de la taxe (plafond 50 % de la taxe)</option></select></div>
      ${T.mode === "base" ? `<table class="t" style="max-width:640px;margin-bottom:10px"><tbody>
        <tr><td>Base brute (K)</td><td class="n">${fmt(T.K)}</td></tr>
        <tr><td>− Frais de formation déduits de la base</td><td class="n">${fmt(T.ded_base)}</td></tr>
        <tr class="tot"><td>Base nette imposable</td><td class="n">${fmt(T.base_nette)}</td></tr>
        <tr><td>TAP 3 % sur base nette des nationaux</td><td class="n">${fmt(T.tap3_net)}</td></tr>
        <tr><td>TAP 5 % sur base nette des non-nationaux</td><td class="n">${fmt(T.tap5_net)}</td></tr></tbody></table>` : ""}
      <table class="t" style="max-width:640px"><tbody>
        <tr><td>Base 3 % (nationaux)</td><td class="n">${fmt(T.base3)}</td><td class="n">${fmt(T.tap3)}</td></tr>
        <tr><td>Base 5 % (non nationaux)</td><td class="n">${fmt(T.base5)}</td><td class="n">${fmt(T.tap5)}</td></tr>
        <tr><td><b>L – Montant global de la taxe</b></td><td></td><td class="n"><b>${fmt(T.L)}</b></td></tr>
        <tr><td>M – Dépenses ouvrant droit à réduction</td><td></td><td class="n">${fmt(T.M)}</td></tr>
        <tr><td>N – ${T.mode === "base" ? "Réduction résultant de la déduction des frais de la base" : "Déduction admise (≤ 50 %)"}</td><td></td><td class="n">${fmt(T.N)}</td></tr>
        <tr><td><b>P – Net à payer</b></td><td></td><td class="n"><b>${fmt(T.P)}</b></td></tr>
      </tbody></table></div>
      <div class="card"><h2 style="margin-top:0">État des apprentis (page 2, 15 lignes)</h2>
      <table class="t"><thead><tr><th>Noms et prénoms</th><th>Matricule</th><th>N° contrat</th><th>Début</th><th>Durée</th><th>Nb mois</th><th class="n">Rémunération</th><th></th></tr></thead><tbody>
      ${t.apprentis.map((a, n) => `<tr>${["nom", "matricule", "contrat", "debut", "duree", "mois", "remuneration"].map((k) => `<td><input ${k === "remuneration" ? 'class="n"' : ""} value="${esc(a[k] ?? "")}" onchange="App.d.tap.apprentis[${n}]['${k}']=this.value;App.save()"></td>`).join("")}
        <td><button class="btn sm danger" onclick="App.d.tap.apprentis.splice(${n},1);App.save().then(()=>App.v_tap())">×</button></td></tr>`).join("")}
      </tbody></table><button class="btn sm" style="margin-top:8px" onclick="App.d.tap.apprentis.push({});App.v_tap()">+ Apprenti</button></div>`;
  },
  async importForm(inp) {
    const fd = new FormData(); fd.append("fichier", inp.files[0]);
    try {
      const rows = await api("/api/import/formations", { method: "POST", body: fd });
      this.d.formations = (this.d.formations || []).concat(rows);
      await this.save(["formations"], true); toast(rows.length + " dépense(s) importée(s)"); this.v_tap();
    } catch (e) { alert(e.message); }
    inp.value = "";
  },
  tapSet(c, k, v) { const t = this.d.tap; t.lignes[c] = t.lignes[c] || {}; t.lignes[c][k] = v === "" && k === "montant" ? null : v; this.save().then(() => this.v_tap()); },

  async v_tcfge() {
    const t = this.d.tcfge; t.lignes = t.lignes || {};
    const r = await api(`/api/dossiers/${this.id}/declarations`);
    const T = r.tcfge;
    const p = this.d.params;
    $("#main").innerHTML = `<h1>Taxe sur certains frais généraux (TCFGE)</h1>
      <p class="sub">Indiquez pour chaque rubrique les comptes concernés (le montant est alors lu dans la balance) ou saisissez le montant brut. La déduction ou l'abattement vient en diminution. Le taux figurant sur l'imprimé du modèle est de 28 % ; il reste modifiable.</p>
      <div class="card" style="padding:0"><table class="t"><thead><tr><th></th><th>Rubrique</th><th>Comptes</th><th class="n">Montant brut forcé</th><th class="n">Déduction / abattement</th><th class="n">Montant net</th></tr></thead><tbody>
      ${r.tcfge_lignes.map(([c, l]) => { const L = t.lignes[c] || {}; const v = T.lignes[c]; return `<tr><td><b>${c}</b></td><td>${esc(l)}</td>
        <td><input value="${esc(L.comptes ?? "")}" onchange="App.tcSet('${c}','comptes',this.value)"></td>
        <td style="width:130px"><input class="n" value="${esc(L.brut ?? "")}" onchange="App.tcSet('${c}','brut',this.value)"></td>
        <td style="width:130px"><input class="n" value="${esc(L.deduction ?? "")}" onchange="App.tcSet('${c}','deduction',this.value)"></td>
        <td class="n">${fmt(v[2])}</td></tr>`; }).join("")}
      </tbody><tfoot><tr><td>f</td><td colspan="4">Total (a + b + c + d + e)</td><td class="n">${fmt(T.base)}</td></tr>
      <tr><td></td><td colspan="4">Taxe (f × taux)</td><td class="n">${T.montant ? fmt(T.montant) : "NÉANT"}</td></tr></tfoot></table></div>
      <div class="card"><div class="grid-form"><div class="f"><label>Taux de la TCFGE</label><input value="${esc(p.taux_tcfge ?? "0.28")}" onchange="App.d.params.taux_tcfge=this.value;App.save().then(()=>App.v_tcfge())"></div></div></div>`;
  },
  tcSet(c, k, v) { const t = this.d.tcfge; t.lignes[c] = t.lignes[c] || {}; t.lignes[c][k] = v === "" && k === "brut" ? null : v; this.save().then(() => this.v_tcfge()); },

  // ------------------------------------------------------- textes
  async v_textes() {
    const def = await api("/api/textes-defaut");
    const tx = this.d.textes;
    const area = (k, l) => `<div class="card"><div class="row"><h2 style="margin:0" class="flex1">${l}</h2>
      <button class="btn sm" onclick="if(confirm('Rétablir le texte type ?')){delete App.d.textes['${k}'];App.save().then(()=>App.v_textes())}">Rétablir le texte type</button></div>
      <textarea oninput="App.d.textes['${k}']=this.value;App.save()">${esc(tx[k] ?? def[k] ?? "")}</textarea></div>`;
    $("#main").innerHTML = `<h1>Textes des notes annexes</h1>
      <p class="sub">Mise en forme : une ligne vide sépare les paragraphes ; « # » en début de ligne pour un titre de section, « ## » pour un sous-titre, « - » pour une puce. Le texte est réparti automatiquement sur le nombre de pages nécessaire.</p>
      ${area("note2", "Note 2 – Informations obligatoires")}${area("note39", "Note 39 – Notes supplémentaires")}`;
  },

  // ------------------------------------------------------- pages
  async v_pages() {
    const excl = new Set(this.d.options.pages_exclues || []);
    const forc = new Set(this.d.options.pages_forcees || []);
    let auto = [];
    try { auto = await api(`/api/dossiers/${this.id}/pages-auto`); } catch (e) { auto = []; }
    this._auto = new Set(auto);
    auto.forEach((i) => { if (!forc.has(i)) excl.add(i); });
    let sec = "";
    const items = this.plan.map((p) => {
      let h = "";
      if (p.section !== sec) { sec = p.section; h += `<div class="sec">${esc(sec)}</div>`; }
      return h + `<div class="pi ${excl.has(p.id) ? "off" : ""}" data-p="${p.id}"><input type="checkbox" ${excl.has(p.id) ? "" : "checked"} title="Inclure dans la liasse" onclick="event.stopPropagation();App.togglePage('${p.id}',this.checked)"><span onclick="App.showPage('${p.id}')">${esc(p.titre)}${this._auto.has(p.id) ? (p.id.startsWith("note") ? ' <i class="help">(non chiffrée)</i>' : ' <i class="help">(doublon du bilan)</i>') : ""}</span></div>`;
    }).join("");
    $("#main").innerHTML = `<div class="viewer"><div class="pagelist">${items}</div>
      <div class="flex1" style="display:flex;flex-direction:column;min-width:0">
        <div class="stage-bar"><b id="pg-title" class="flex1"></b>
          <button class="btn sm" onclick="App.pageNav(-1)">◀ Précédente</button><button class="btn sm" onclick="App.pageNav(1)">Suivante ▶</button>
          <select id="zoom" style="width:90px" onchange="App.showPage(App._page)"><option value="0.8">80 %</option><option value="1" selected>100 %</option><option value="1.25">125 %</option><option value="1.5">150 %</option></select>
          <button class="btn sm" onclick="App.pageListe()">Saisie en liste</button>
          <button class="btn sm" onclick="App.resetPage(App._page)">Rétablir les calculs</button>
          <a class="btn sm" id="pg-pdf" target="_blank">PDF de la page</a></div>
        <div class="help" style="margin-bottom:6px">Les notes non chiffrées ne sont pas imprimées et sont cochées N/A dans la fiche R4 ; le bilan n'est imprimé qu'une fois (modèle paysage). Cochez une page pour la réintégrer.</div>
        <div class="help" style="margin-bottom:6px">Cliquez sur une cellule pour la compléter. Contour orange : cellule calculée (la saisie remplace le calcul, « Rétablir » revient à la formule).</div>
        <div class="stage" id="stage"></div></div></div>`;
    this.showPage(this._page || "garde");
  },
  pageListe() {
    modal(`<h2 style="margin-top:0">Saisie en liste – ${esc($("#pg-title").textContent)}</h2><div id="ml">Chargement…</div>
      <div class="row" style="margin-top:12px"><button class="btn primary" onclick="closeModal();App.showPage(App._page)">Fermer et actualiser la page</button></div>`);
    this.renderList(this._page, "#ml");
  },
  async retirerNA() {
    const ids = await api(`/api/dossiers/${this.id}/notes-na`);
    const s = new Set(this.d.options.pages_exclues || []); ids.forEach((i) => s.add(i));
    this.d.options.pages_exclues = [...s]; await this.save(["options"], true);
    toast(ids.length + " note(s) non applicable(s) retirée(s)"); this.v_pages();
  },
  togglePage(pid, on) {
    const s = new Set(this.d.options.pages_exclues || []);
    const f = new Set(this.d.options.pages_forcees || []);
    if (this._auto && this._auto.has(pid)) { on ? f.add(pid) : f.delete(pid); s.delete(pid); }
    else { on ? s.delete(pid) : s.add(pid); }
    this.d.options.pages_exclues = [...s];
    this.d.options.pages_forcees = [...f];
    this.save(["options"]);
    $(`.pi[data-p="${pid}"]`).classList.toggle("off", !on);
  },
  pageNav(dir) {
    const ids = this.plan.map((p) => p.id);
    const i = ids.indexOf(this._page) + dir;
    if (i >= 0 && i < ids.length) this.showPage(ids[i]);
  },
  async showPage(pid) {
    this._page = pid;
    $$(".pi").forEach((e) => e.classList.toggle("active", e.dataset.p === pid));
    const p = this.plan.find((x) => x.id === pid);
    $("#pg-title").textContent = p ? p.titre : "";
    $("#pg-pdf").href = `/api/dossiers/${this.id}/export.pdf?pages=${pid}`;
    const z = $("#zoom") ? $("#zoom").value : 1;
    const st = $("#stage");
    const scroll = st.scrollTop;
    st.innerHTML = await api(`/api/dossiers/${this.id}/page/${pid}?zoom=${z}`);
    st.scrollTop = scroll;
    $$(".c.e", st).forEach((el) => el.addEventListener("click", (ev) => this.editCell(el, ev)));
    const act = $(`.pi[data-p="${pid}"]`); act && act.scrollIntoView({ block: "nearest" });
  },
  editCell(el, ev) {
    ev.stopPropagation();
    $$(".cell-editor").forEach((x) => x.remove());
    const ref = el.dataset.ref;
    const isF = el.classList.contains("f"), forced = el.classList.contains("forced");
    let raw = el.dataset.raw ?? "";
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) { const [y, m, d] = raw.slice(0, 10).split("-"); raw = `${d}/${m}/${y}`; }
    const box = document.createElement("div");
    box.className = "cell-editor";
    const r = el.getBoundingClientRect(), sr = $("#stage").getBoundingClientRect();
    box.style.left = (r.left - sr.left + $("#stage").scrollLeft) + "px";
    box.style.top = (r.bottom - sr.top + $("#stage").scrollTop + 4) + "px";
    box.innerHTML = `<textarea style="min-height:54px" id="ce-v">${esc(raw)}</textarea>
      <div class="hint">${esc(ref)}${isF ? " · cellule calculée" : ""}${forced ? " · valeur saisie" : ""}</div>
      <div class="row"><button class="btn sm primary" id="ce-ok">Valider</button>${forced ? `<button class="btn sm" id="ce-reset">Rétablir</button>` : ""}<button class="btn sm" id="ce-x">Annuler</button></div>`;
    $("#stage").style.position = "relative";
    $("#stage").appendChild(box);
    const ta = $("#ce-v"); ta.focus(); ta.select();
    const send = async (value) => {
      await this.flush();
      const r = await api(`/api/dossiers/${this.id}/cellule`, { json: { ref, value } });
      if (r.parametre) this.d.params = (await api(`/api/dossiers/${this.id}`)).params || {};
      this.d.cells = this.d.cells || {};
      box.remove(); this.showPage(this._page);
    };
    $("#ce-ok").onclick = () => send(ta.value);
    $("#ce-x").onclick = () => box.remove();
    if (forced) $("#ce-reset").onclick = () => send("__reset__");
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(ta.value); }
      if (e.key === "Escape") box.remove();
    });
  },

  // ------------------------------------------------------- export
  async v_export() {
    await this.synthese();
    const crit = (this.alerts || []).filter((a) => a.niveau === "critique");
    const secs = [...new Set(this.plan.map((p) => p.section))];
    $("#main").innerHTML = `<h1>Exporter la liasse</h1>
      <p class="sub">Le PDF est au format A4, en noir et blanc (condition de recevabilité DGI), chaque page en portrait ou en paysage selon son contenu. Le classeur Excel contient une feuille par page, avec la même mise en page d'impression.</p>
      ${crit.length ? `<div class="card" style="border-color:#e3a39c;background:#fdf3f2"><b>${crit.length} alerte(s) critique(s)</b> : ${crit.map((a) => esc(a.titre)).join(" · ")}. <button class="btn sm" onclick="App.go('alertes')">Voir</button></div>` : ""}
      <div class="card"><h2 style="margin-top:0">Liasse complète</h2>
        <div class="row"><a class="btn accent" href="/api/dossiers/${this.id}/export.pdf?dl=1">Télécharger le PDF</a>
        <a class="btn" href="/api/dossiers/${this.id}/export.pdf" target="_blank">Ouvrir le PDF</a>
        <a class="btn primary" href="/api/dossiers/${this.id}/export.xlsx">Télécharger l'Excel</a></div>
        <p class="help">Les notes non chiffrées sont retirées d'office (cochées N/A en fiche R4) et le bilan n'est imprimé qu'une fois. Les pages décochées dans « Pages de la liasse » sont également exclues.</p></div>
      <div class="card"><h2 style="margin-top:0">Rapport de gestion financière</h2>
        <div class="row"><a class="btn primary" href="/api/dossiers/${this.id}/rapport.pdf?dl=1">Télécharger le rapport (PDF)</a><button class="btn" onclick="App.go('rapport')">Voir et compléter</button></div>
        <p class="help">Document interne (non déposé à la DGI) : performance, faiblesses, tableau de bord et recommandations.</p></div>
      <div class="card"><h2 style="margin-top:0">Par partie</h2>
        ${secs.map((s) => { const ids = this.plan.filter((p) => p.section === s).map((p) => p.id).join(","); return `<div class="row" style="margin-bottom:8px"><span style="width:200px">${esc(s)}</span>
          <a class="btn sm" href="/api/dossiers/${this.id}/export.pdf?dl=1&pages=${ids}">PDF</a><a class="btn sm" href="/api/dossiers/${this.id}/export.xlsx?pages=${ids}">Excel</a></div>`; }).join("")}
      </div>
      <div class="card"><h2 style="margin-top:0">Sauvegarde du dossier</h2><a class="btn" href="/api/dossiers/${this.id}/sauvegarde">Télécharger la sauvegarde (.json)</a>
      <p class="help">La base locale est enregistrée sur ce poste ; la sauvegarde permet de transférer un dossier vers un autre ordinateur.</p></div>`;
  },

  async quitter() {
    if (window.SL_WEB) { toast("Les données sont enregistrées sur cet appareil. Fermez simplement l'application ou l'onglet."); return; }
    if (!confirm("Fermer Smart Liasse ? Les données sont déjà enregistrées.")) return;
    try { await api("/api/quitter", { method: "POST" }); } catch (e) {}
    document.body.innerHTML = '<div style="padding:60px;text-align:center;font-family:Segoe UI,Arial"><h2>Smart Liasse est fermé.</h2><p>Vous pouvez fermer cet onglet. Pour revenir : double-clic sur « Smart Liasse ».</p></div>';
  },
  async apropos() {
    const a = await api("/api/apropos");
    modal(`<h2 style="margin-top:0">Smart Liasse ${a.version}</h2>
      <p>Base locale : <code>${esc(a.base)}</code></p>
      <h2>Corrections apportées aux formules du modèle d'origine</h2>
      <table class="t"><thead><tr><th>Feuille</th><th>Cellule</th><th>Objet</th></tr></thead><tbody>
      ${a.corrections.map((c) => `<tr><td>${esc(c.feuille)}</td><td>${esc(c.cellule)}</td><td>${esc(c.objet)}</td></tr>`).join("")}</tbody></table>
      <div class="row" style="margin-top:14px"><button class="btn" onclick="closeModal()">Fermer</button></div>`);
  },
};

document.addEventListener("click", (e) => {
  if (!e.target.closest(".cell-editor") && !e.target.closest(".c.e")) $$(".cell-editor").forEach((x) => x.remove());
});
App.init();

// petits ecrans : le menu lateral se referme apres un choix
document.addEventListener("click", (e) => {
  if (document.body.classList.contains("menu-open") && e.target.closest && e.target.closest("#side a")) document.body.classList.remove("menu-open");
  if (document.body.classList.contains("menu-open") && e.target.id === "layout") document.body.classList.remove("menu-open");
});
