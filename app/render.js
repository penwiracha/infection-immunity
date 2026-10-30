/* ============================================================
   render.js — what a student sees. Used by the Learn page AND by the
   instructor previews, so "preview as a student" is the same code path.
   ============================================================ */
;(function (root) {
  "use strict";
  const { el, bulletLines } = root.Safe;

  const NICHE_COL = { extra: "var(--extra)", vesic: "var(--vesic)", cyto: "var(--cyto)", surf: "var(--surf)" };
  const label = (vocab, kind, id) => (vocab && vocab[kind] && vocab[kind][id]) || id;
  const NICHE_SHORT = { extra: "Extracellular", vesic: "Vesicular", cyto: "Cytosolic", surf: "Surface" };
  const shortNiche = (vocab, id) => {
    if (NICHE_SHORT[id]) return NICHE_SHORT[id];
    const head = String(label(vocab, "niche", id) || "").split(" —")[0].trim();
    return head.charAt(0) + head.slice(1).toLowerCase();
  };
  const cascadeLabel = (id) => {
    const m = /^([a-z]+):S(\d+)$/i.exec(id || "");
    return m ? `Cascade, step ${m[2]}` : id;
  };

  /* lecture: {number,title,niche,summary,disease_ids,organism_ids,cascade_step}
     opts.actions: nodes to place under the summary (buttons). */
  function renderLecture(lec, vocab, opts) {
    opts = opts || {};
    const items = bulletLines(lec.summary);
    const linked = [
      lec.cascade_step ? el("span", { class: "chip", title: label(vocab, "cascade_step", lec.cascade_step) }, cascadeLabel(lec.cascade_step)) : null,
      lec.niche ? el("span", { class: "chip" }, "Niche map, " + shortNiche(vocab, lec.niche).toLowerCase()) : null,
      (lec.organism_ids || []).map((id) => el("span", { class: "chip" }, label(vocab, "organism", id))),
      (lec.disease_ids || []).map((id) => el("span", { class: "chip" }, label(vocab, "disease", id)))
    ].flat().filter(Boolean);
    return el("article", { class: "lecture" },
      el("div", { class: "eyebrow" }, `Lecture ${lec.number ?? "?"} summary`),
      el("h2", { class: "lecture-title", translate: lec.title ? "no" : null }, lec.title || "Untitled lecture"),
      items.length
        ? el("ul", { class: "bullets", translate: "no" }, items.map((t) => el("li", null, t)))
        : el("p", { class: "dim" }, "No summary yet."),
      linked.length ? el("div", { class: "linked" }, el("span", { class: "k" }, "Linked to"), el("span", { translate: "no" }, linked)) : null,
      opts.actions ? el("div", { class: "row", style: { marginTop: "18px" } }, opts.actions) : null
    );
  }

  let qSeq = 0;
  /* version: {id, stem, options:[{id,text}], niche}
     opts.onAnswer(optionId) -> Promise<{correct, correct_option_id, explanation}>
     opts.preview: {correct_option_id, explanation} lets instructors try it without recording anything.
     opts.meta: {left, right, progress 0..1} header above the stem.
     opts.onNext + opts.nextLabel: show a "Next" button after answering.
     opts.confidence: show "How sure are you?" (guess / unsure / sure); onAnswer gets it as 2nd arg. */
  function renderQuestion(version, opts) {
    opts = opts || {};
    const name = "q" + (++qSeq);
    const feedback = el("div", { class: "feedback", "aria-live": "polite" });
    const rows = [];
    let chosen = null, done = false;
    const check = el("button", { class: "btn primary", type: "button", disabled: true }, "Check answer");
    const after = el("div", { class: "row", style: { marginTop: "16px" } });
    let confidence = null;
    const confBox = opts.confidence ? confidencePicker((c) => { confidence = c; }) : null;

    const options = el("div", { class: "options", role: "radiogroup" },
      (version.options || []).map((o) => {
        const input = el("input", { type: "radio", name, value: o.id });
        const row = el("label", { class: "opt", dataset: { opt: o.id } }, input, el("span", { class: "opttext", translate: "no" }, o.text));
        input.addEventListener("change", () => {
          if (done) return;
          chosen = o.id;
          rows.forEach((r) => r.classList.toggle("chosen", r === row));
          check.disabled = false;
        });
        rows.push(row);
        return row;
      }));

    check.addEventListener("click", async () => {
      if (done || !chosen) return;
      done = true; check.disabled = true;
      let res;
      try {
        res = opts.preview
          ? { correct: chosen === opts.preview.correct_option_id, ...opts.preview }
          : await opts.onAnswer(chosen, confidence);
      } catch (e) {
        done = false; check.disabled = false;
        feedback.replaceChildren(el("p", { class: "err" }, e.message || String(e)));
        return;
      }
      for (const r of rows) {
        r.classList.add("locked");
        r.querySelector("input").disabled = true;
        if (r.dataset.opt === res.correct_option_id) r.classList.add("right");
        else if (r.dataset.opt === chosen) r.classList.add("wrong");
      }
      check.hidden = true;
      if (confBox) confBox.querySelectorAll("button").forEach((b) => (b.disabled = true));
      const right = (version.options || []).find((o) => o.id === res.correct_option_id);
      feedback.replaceChildren(
        el("p", { class: "verdict " + (res.correct ? "ok" : "bad") },
          res.correct ? "Correct." : `Not quite. The answer is ${right ? right.text : res.correct_option_id}.`),
        el("p", { class: "explain", translate: "no" }, res.explanation || ""));
      if (opts.onNext) after.replaceChildren(el("button", { class: "btn primary", type: "button", onclick: opts.onNext }, opts.nextLabel || "Next question"));
    });

    const m = opts.meta;
    return el("div", { class: "question" },
      m ? el("div", { class: "qhead" }, el("span", null, m.left || ""), el("span", null, m.right || "")) : null,
      m && m.progress != null ? el("div", { class: "progress" }, el("span", { style: { width: Math.round(m.progress * 100) + "%" } })) : null,
      el("p", { class: "stem", translate: "no" }, version.stem || ""),
      options,
      confBox,
      check, feedback, after);
  }

  /* "How sure are you?" — three toggle buttons. */
  function confidencePicker(onPick, initial) {
    const btns = [["guess", "Guess"], ["unsure", "Unsure"], ["sure", "Sure"]].map(([v, t]) => {
      const b = el("button", { class: "btn seg", type: "button", "aria-pressed": String(initial === v), dataset: { v } }, t);
      b.addEventListener("click", () => {
        btns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        onPick(v);
      });
      return b;
    });
    return el("div", { class: "confidence" }, el("div", { class: "k", style: { marginBottom: "8px" } }, "How sure are you?"),
      el("div", { class: "row", role: "group", "aria-label": "How sure are you?" }, btns));
  }

  root.Render = { renderLecture, renderQuestion, confidencePicker, NICHE_COL, NICHE_SHORT, label, shortNiche, cascadeLabel };
})(typeof globalThis !== "undefined" ? globalThis : this);
