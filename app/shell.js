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

  /* Sign in with email + password typed on the site. Modes: signin · signup · forgot. */
  function signInScreen(container, sub, note, mode) {
    mode = mode || "signin";
    const again = (m) => () => signInScreen(container, sub, note, m);
    const email = el("input", { type: "email", placeholder: "name@university.ac.th", required: true, autocomplete: "email" });
    const pw = el("input", { type: "password", required: true, minlength: 8,
      autocomplete: mode === "signup" ? "new-password" : "current-password" });
    const pw2 = el("input", { type: "password", required: true, minlength: 8, autocomplete: "new-password" });
    const name = el("input", { type: "text", required: true, autocomplete: "name", placeholder: "Name shown to your instructors" });
    const msg = el("p", { class: "dim", style: { margin: "14px 0 0" }, role: "status" });
    const say = (t, bad) => { msg.textContent = t; msg.className = bad ? "err" : "dim"; };
    const link = (t, fn) => el("button", { class: "linkbtn", type: "button", onclick: fn }, t);
    const btnLabel = { signin: "Sign in", signup: "Create account", forgot: "Email me a reset link" }[mode];
    const btn = el("button", { class: "btn primary", type: "submit" }, btnLabel);

    const fields = mode === "signup"
      ? [el("label", { class: "f" }, el("span", null, "Name"), name), el("label", { class: "f" }, el("span", null, "Email"), email),
         el("label", { class: "f" }, el("span", null, "Password"), pw, el("div", { class: "hint" }, "At least 8 characters.")),
         el("label", { class: "f" }, el("span", null, "Repeat password"), pw2)]
      : mode === "forgot"
        ? [el("label", { class: "f" }, el("span", null, "Email"), email)]
        : [el("label", { class: "f" }, el("span", null, "Email"), email), el("label", { class: "f" }, el("span", null, "Password"), pw)];

    const form = el("form", { class: "authcard", novalidate: true },
      el("h2", null, { signin: "Sign in", signup: "Create your account", forgot: "Reset your password" }[mode]),
      el("p", { class: "sub" }, mode === "forgot" ? "We will email you a link to choose a new password." : (sub || "Use your university email.")),
      root.API.configured ? null : el("div", { class: "banner warn" },
        "Supabase is not configured yet. Add your project URL and anon key to app/config.js."),
      fields, btn, msg,
      el("div", { style: { marginTop: "18px", display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" } },
        mode === "signin" ? [link("Forgot your password?", again("forgot")), el("span", { class: "dim" }, "New here? ", link("Create an account", again("signup")))]
                          : link("Back to sign in", again("signin"))));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const em = email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(em)) return say("Enter your email address.", true);
      if (mode !== "forgot" && pw.value.length < 8) return say("The password needs at least 8 characters.", true);
      if (mode === "signup" && !name.value.trim()) return say("Enter your name.", true);
      if (mode === "signup" && pw.value !== pw2.value) return say("The two passwords do not match.", true);
      btn.disabled = true; say("Please wait…");
      try {
        if (mode === "signin") {
          await root.API.signInPassword(em, pw.value);
          location.reload();
        } else if (mode === "signup") {
          const ready = await root.API.signUp(em, pw.value, name.value.trim());
          if (ready) location.reload();
          else { say("Account created. Check your email for a confirmation link, then sign in here."); btn.disabled = false; }
        } else {
          await root.API.resetPassword(em);
          say("If that email has an account, a reset link is on its way. Check Spam too.");
        }
      } catch (err) {
        btn.disabled = false;
        const m = err.message || String(err);
        say(/invalid login/i.test(m) ? "Wrong email or password."
          : /not confirmed/i.test(m) ? "This account's email is not confirmed yet. Ask your course admin."
          : /already registered/i.test(m) ? "There is already an account with this email. Sign in instead."
          : /rate limit/i.test(m) ? "Too many attempts. Please wait a few minutes and try again." : m, true);
      }
    });
    fill(container, el("div", { class: "authwrap" }, form, note && mode === "signin" ? el("p", { class: "authnote" }, note) : null));
    (mode === "signup" ? name : email).focus();
  }

  /* Shown after someone opens the link in a reset-password email. */
  function newPasswordScreen(container) {
    const pw = el("input", { type: "password", minlength: 8, autocomplete: "new-password" });
    const pw2 = el("input", { type: "password", minlength: 8, autocomplete: "new-password" });
    const msg = el("p", { class: "dim", style: { margin: "14px 0 0" }, role: "status" });
    const btn = el("button", { class: "btn primary", type: "submit" }, "Save new password");
    const form = el("form", { class: "authcard", novalidate: true }, el("h2", null, "Choose a new password"),
      el("label", { class: "f" }, el("span", null, "New password"), pw, el("div", { class: "hint" }, "At least 8 characters.")),
      el("label", { class: "f" }, el("span", null, "Repeat new password"), pw2), btn, msg);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (pw.value.length < 8) { msg.textContent = "The password needs at least 8 characters."; msg.className = "err"; return; }
      if (pw.value !== pw2.value) { msg.textContent = "The two passwords do not match."; msg.className = "err"; return; }
      btn.disabled = true;
      try { await root.API.updatePassword(pw.value); location.replace(location.pathname); }
      catch (err) { msg.textContent = err.message; msg.className = "err"; btn.disabled = false; }
    });
    fill(container, el("div", { class: "authwrap" }, form));
  }

  root.Shell = { toast, modal, confirmBox, signInScreen, newPasswordScreen, avatarMenu, initials };
})(typeof globalThis !== "undefined" ? globalThis : this);
