/* ============================================================
   shell.js — header avatar menu, toasts, modals and the sign-in
   screen, shared by the signed-in pages.
   ============================================================ */
;(function (root) {
  "use strict";
  const { el, clear, fill } = root.Safe;

  function toast(msg, bad) {
    const t = el("div", { class: "toast" + (bad ? " bad" : ""), role: "status" }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), bad ? 6500 : 3000);
  }

  /* modal(title, bodyNodes, [{label, cls, onClick(close)}]) */
  function modal(title, body, actions) {
    const back = el("div", { class: "modal-back" });
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const box = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
      el("h3", null, title), body,
      el("div", { class: "row end", style: { marginTop: "20px" } },
        (actions || [{ label: "Close" }]).map((a) =>
          el("button", { class: "btn " + (a.cls || ""), type: "button",
            onclick: () => (a.onClick ? a.onClick(close) : close()) }, a.label))));
    back.appendChild(box);
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    return { close, box };
  }

  function confirmBox(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal(title, Array.isArray(text) ? text : el("p", null, text), [
        { label: "Cancel", onClick: (c) => { done = true; c(); resolve(false); } },
        { label: okLabel || "OK", cls: danger ? "danger" : "primary", onClick: (c) => { done = true; c(); resolve(true); } }
      ]);
      const obs = new MutationObserver(() => { if (!document.body.contains(m.box) && !done) { obs.disconnect(); resolve(false); } });
      obs.observe(document.body, { childList: true });
    });
  }

  const initials = (name) => (String(name || "?").trim().split(/[\s@._-]+/).filter(Boolean)
    .slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();

  /* Avatar button in the header that opens a small account menu.
     links: [{label, href}] */
  function avatarMenu(button, profile, email, links) {
    button.hidden = false;
    button.textContent = initials(profile.display_name || email);
    button.setAttribute("aria-label", "Account menu");
    button.setAttribute("aria-haspopup", "menu");
    let menu = null;
    const close = () => { if (menu) { menu.remove(); menu = null; button.setAttribute("aria-expanded", "false"); } };
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu) return close();
      menu = el("div", { class: "menu", role: "menu" },
        el("div", { class: "who" }, el("b", null, profile.display_name || email), el("span", { class: "dim" }, `${email} · ${profile.role || "student"}`)),
        (links || []).map((l) => el("a", { href: l.href, role: "menuitem" }, l.label)),
        el("button", { type: "button", role: "menuitem", onclick: async () => { await root.API.signOut(); location.reload(); } }, "Sign out"));
      button.closest(".top").appendChild(menu);
      button.setAttribute("aria-expanded", "true");
    });
    document.addEventListener("click", (e) => { if (menu && !menu.contains(e.target)) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  function signInScreen(container, sub, note) {
    const email = el("input", { type: "email", placeholder: "name@university.ac.th", required: true, autocomplete: "email" });
    const msg = el("p", { class: "dim", style: { margin: "14px 0 0" } });
    const btn = el("button", { class: "btn primary", type: "submit" }, "Email me a sign-in link");
    const form = el("form", { class: "authcard" },
      el("h2", null, "Sign in"),
      el("p", { class: "sub" }, sub || "Use your university email."),
      root.API.configured ? null : el("div", { class: "banner warn" },
        "Supabase is not configured yet. Add your project URL and anon key to app/config.js."),
      el("label", { class: "f" }, el("span", null, "Email"), email),
      btn, msg);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try { await root.API.signIn(email.value.trim()); msg.textContent = "Check your inbox for the sign-in link. It works once."; }
      catch (err) { msg.textContent = err.message; msg.className = "err"; btn.disabled = false; }
    });
    fill(container, el("div", { class: "authwrap" }, form, note ? el("p", { class: "authnote" }, note) : null));
  }

  root.Shell = { toast, modal, confirmBox, signInScreen, avatarMenu, initials };
})(typeof globalThis !== "undefined" ? globalThis : this);
