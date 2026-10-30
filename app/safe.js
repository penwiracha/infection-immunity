/* ============================================================
   safe.js — the only way app pages put data on screen.
   Every piece of lecture/question text goes through textContent, never
   innerHTML, so "<script>" in a stem or summary is shown as characters.
   ============================================================ */
;(function (root) {
  "use strict";

  /* el("div", {class:"x", onclick:fn, dataset:{id:1}}, "text", childNode, [more]) */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "dataset") Object.assign(n.dataset, v);
        else if (k === "style" && typeof v === "object") {
          for (const [sk, sv] of Object.entries(v)) sk.startsWith("--") ? n.style.setProperty(sk, sv) : (n.style[sk] = sv);
        }
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else if (k === "value") n.value = v;
        else if (k === "checked" || k === "disabled" || k === "selected" || k === "multiple" || k === "required") n[k] = !!v;
        else if (k === "text") n.textContent = String(v);
        else if (/^(href|src)$/.test(k) && !/^(https?:|#|\.{0,2}\/|[\w-]+\.html)/i.test(String(v))) continue; // no javascript: URLs
        else n.setAttribute(k, String(v));
      }
    }
    append(n, kids);
    return n;
  }
  function append(n, kids) {
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  /* Replace a node's children; accepts nested arrays and skips null/false. */
  function fill(n, ...kids) { return append(clear(n), kids); }

  /* Plain-text bullets: one per line; leading "-", "*", "•" or "1." markers are dropped. */
  function bulletLines(text) {
    return String(text || "").split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•‣▪]|\d+[.)])\s*/, "").trim())
      .filter(Boolean);
  }

  // dates follow the interface language (Thai shows Thai month names and the Buddhist-era year)
  const loc = () => (root.I18N && root.I18N.locale ? root.I18N.locale() : undefined);
  const fmtDate = (d) => d ? new Date(d).toLocaleString(loc(), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const fmtDay  = (d) => d ? new Date(d).toLocaleDateString(loc(), { dateStyle: "medium" }) : "—";

  /* CSV with formula-injection guard (cells starting = + - @ are prefixed with '). */
  function toCSV(rows, cols) {
    const esc = (v) => {
      let s = v == null ? "" : Array.isArray(v) ? v.join(";") : typeof v === "object" ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
  }
  /* Minimal RFC-4180 CSV parser -> array of objects keyed by the header row. */
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    text = String(text).replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
    if (!nonEmpty.length) return [];
    const head = nonEmpty[0].map((h) => h.trim().toLowerCase());
    return nonEmpty.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
  }
  function download(name, text, type) {
    const a = el("a", { href: "#" });
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  root.Safe = { el, append, clear, fill, bulletLines, fmtDate, fmtDay, toCSV, parseCSV, download };
})(typeof globalThis !== "undefined" ? globalThis : this);
