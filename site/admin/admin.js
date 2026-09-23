// Sruthi Arts Studio — an Instagram-style admin that edits the site's content files through the GitHub API.
// Every save is a commit to main; GitHub Actions rebuilds the site about a minute later.
(() => {
  "use strict";

  const REPO = "anilkumardvr/SruthiArts";
  const BRANCH = "main";
  const API = "https://api.github.com";
  const TOKEN_KEY = "sruthiarts.token";
  const CATS = [
    { id: "ludo-boards", label: "Ludo boards" },
    { id: "clocks", label: "Clocks" },
    { id: "originals", label: "Originals" },
    { id: "prints", label: "Prints" },
  ];
  const MEDIUMS = ["Acrylic on canvas", "Oil on canvas", "Watercolor", "Gouache", "Mixed media", "Ink on paper", "Pencil on paper", "Acrylic on wood", "Art print"];
  const CURRENCIES = ["CAD", "USD", "INR", "GBP", "EUR"];

  const S = { token: "", user: null, items: [], pages: null, pagesSha: "", settings: {}, settingsSha: "", orders: null, ordersError: "", tab: "posts", filter: "all", publish: null, site: {} };
  const app = document.getElementById("app");

  // ---------- tiny helpers ----------
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v; // static icon markup only
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "value") n.value = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach((c) => c !== null && c !== undefined && c !== false && n.append(c));
    return n;
  };
  const ICON = {
    grid: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.3 11.2a1.5 1.5 0 0 1-1.5 1.3H7.8a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 11h14M5 16h9"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    photo: '<svg viewBox="0 0 96 96"><rect x="14" y="22" width="56" height="56" rx="10"/><rect x="26" y="14" width="56" height="56" rx="10" fill="#fff"/><circle cx="44" cy="32" r="5"/><path d="M28 64l14-14 10 10 8-8 20 20"/></svg>',
    gh: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
    heart: '<svg class="heart" viewBox="0 0 24 24"><defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2c46b"/><stop offset=".5" stop-color="#e0789c"/><stop offset="1" stop-color="#a8325e"/></linearGradient></defs><path d="M12 21s-7.5-4.6-9.6-9.2C.8 8.2 3 4 6.9 4c2.2 0 3.7 1.2 5.1 3 1.4-1.8 2.9-3 5.1-3 3.9 0 6.1 4.2 4.5 7.8C19.5 16.4 12 21 12 21z"/></svg>',
    cart: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.3 11.2a1.5 1.5 0 0 1-1.5 1.3H7.8a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
  };
  const LOGO = "<svg class=\"logo-mark\" viewBox=\"0 0 200 64\" aria-hidden=\"true\" focusable=\"false\"><defs><linearGradient id=\"lgfA\" x1=\"0\" x2=\"1\"><stop offset=\"0\" stop-color=\"#e0789c\" stop-opacity=\"0\"/><stop offset=\".22\" stop-color=\"#e0789c\"/><stop offset=\".8\" stop-color=\"#c8927a\"/><stop offset=\"1\" stop-color=\"#c8927a\" stop-opacity=\"0\"/></linearGradient></defs><path class=\"lg-flourish\" d=\"M6 53c34-10 64 8 104-2 24-6 40-15 66-10\" fill=\"none\" stroke=\"url(#lgfA)\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><text class=\"lg-word\" x=\"86\" y=\"42\" text-anchor=\"middle\" font-family=\"'Mrs Saint Delafield', 'Brush Script MT', cursive\" font-size=\"48\" fill=\"currentColor\">Sruthi</text><path class=\"lg-moon\" d=\"M171 7a8.5 8.5 0 1 0 7.4 12.3 6.6 6.6 0 1 1-7.4-12.3z\" fill=\"#f2c46b\"/><path class=\"lg-spark\" d=\"M20 10l2.4 5.6 5.6 2.4-5.6 2.4L20 26l-2.4-5.6-5.6-2.4 5.6-2.4z\" fill=\"#e0789c\"/><path class=\"lg-spark s2\" d=\"M188 30l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z\" fill=\"#c8927a\"/><text class=\"lg-arts\" x=\"178\" y=\"56\" text-anchor=\"middle\" font-family=\"Karla, system-ui, sans-serif\" font-weight=\"700\" font-size=\"9\" letter-spacing=\"3.6\" fill=\"#a8325e\">ARTS</text></svg>";
  const logo = (tag = "span") => el(tag, { class: "logo", "aria-label": "Sruthi Arts", html: LOGO });
  const icon = (name, cls) => el("span", { class: cls || "", html: ICON[name], "aria-hidden": "true", style: "display:contents" });

  function toast(msg, kind = "") {
    const t = el("div", { class: `toast ${kind}`, text: msg });
    document.getElementById("toasts").append(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, kind === "err" ? 5200 : 3000);
  }
  const enc = new TextEncoder();
  const toB64 = (str) => { let bin = ""; for (const b of enc.encode(str)) bin += String.fromCharCode(b); return btoa(bin); };
  const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  const blobToB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const pad = (n) => String(n).padStart(2, "0");
  const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const relImg = (p) => String(p || "").trim().replace(/^\/+/, "").replace(/^site\//, "");
  const imgUrl = (p) => (p ? (p.startsWith("blob:") ? p : `https://raw.githubusercontent.com/${REPO}/${BRANCH}/site/${relImg(p)}`) : "");
  const stockOf = (it) => (it.status === "sold" ? 0 : Number.isFinite(Number(it.quantity)) ? Math.max(0, Math.floor(Number(it.quantity))) : 1);
  const catLabel = (id) => (CATS.find((c) => c.id === id) || { label: id || "Uncategorized" }).label;
  const money = (n) => { try { return new Intl.NumberFormat("en-CA", { style: "currency", currency: S.settings.currency || "CAD", maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n); } catch { return `$${n}`; } };
  const checkoutApi = () => (S.settings.checkoutApi || S.site.checkoutApi || "").replace(/\/+$/, "");

  // ---------- GitHub API ----------
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, { ...opts, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${S.token}`, "x-github-api-version": "2022-11-28", ...(opts.body ? { "content-type": "application/json" } : {}), ...(opts.headers || {}) } });
    if (res.status === 401) {
      if (S.user) { signOut("Your login expired. Please sign in again."); throw new Error("Signed out"); }
      throw new Error("That token didn't work. Check it and try again.");
    }
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || `GitHub error ${res.status}`); e.status = res.status; throw e; }
    return data;
  }
  const contents = (path) => `/repos/${REPO}/contents/${path}`;
  async function getJson(path) {
    const d = await gh(`${contents(path)}?ref=${BRANCH}&t=${Date.now()}`);
    return { sha: d.sha, data: JSON.parse(fromB64(d.content)) };
  }
  async function putFile(path, b64, message, sha) {
    const d = await gh(contents(path), { method: "PUT", body: JSON.stringify({ message, content: b64, branch: BRANCH, ...(sha ? { sha } : {}) }) });
    watchPublish(d.commit && d.commit.sha);
    return d;
  }
  const putJson = (path, data, message, sha) => putFile(path, toB64(JSON.stringify(data, null, 2) + "\n"), message, sha);
  async function deleteFile(path, sha, message) {
    const d = await gh(contents(path), { method: "DELETE", body: JSON.stringify({ message, sha, branch: BRANCH }) });
    watchPublish(d.commit && d.commit.sha);
  }

  // "Publishing… / Live" pill: follows the GitHub Actions run for the latest save.
  let publishTimer = null;
  function watchPublish(sha) {
    if (!sha) return;
    S.publish = { sha, state: "publishing", started: Date.now() };
    renderPublish();
    clearTimeout(publishTimer);
    const poll = async () => {
      if (!S.publish || S.publish.sha !== sha) return;
      try {
        const runs = await gh(`/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=1`);
        const run = runs.workflow_runs && runs.workflow_runs[0];
        if (run && run.status === "completed") {
          S.publish.state = run.conclusion === "success" ? "live" : run.conclusion === "cancelled" ? "publishing" : "fail";
          renderPublish();
          if (S.publish.state === "live") { toast("Your changes are live on the site ✨"); setTimeout(() => { if (S.publish && S.publish.sha === sha) { S.publish = null; renderPublish(); } }, 6000); return; }
          if (S.publish.state === "fail") return;
        }
      } catch { /* token without Actions access: fall back to a timer */ if (Date.now() - S.publish.started > 90000) { S.publish.state = "live"; renderPublish(); return; } }
      if (Date.now() - S.publish.started < 6 * 60 * 1000) publishTimer = setTimeout(poll, 5000);
    };
    publishTimer = setTimeout(poll, 6000);
  }
  function renderPublish() {
    const slot = document.getElementById("publish-slot");
    if (!slot) return;
    const p = S.publish;
    slot.replaceChildren(p ? el("span", { class: `publish ${p.state === "live" ? "live" : p.state === "fail" ? "fail" : ""}` }, el("i"), p.state === "live" ? "Live" : p.state === "fail" ? "Publish failed" : "Publishing…") : "");
  }

  // ---------- load ----------
  async function loadAll() {
    const [list, pages, settings] = await Promise.all([
      gh(`${contents("content/items")}?ref=${BRANCH}&t=${Date.now()}`).catch((e) => (e.status === 404 ? [] : Promise.reject(e))),
      getJson("content/pages.json"),
      getJson("content/settings.json"),
    ]);
    S.pages = pages.data; S.pagesSha = pages.sha;
    S.settings = settings.data; S.settingsSha = settings.sha;
    const files = list.filter((f) => f.type === "file" && f.name.endsWith(".json"));
    S.items = (await Promise.all(files.map(async (f) => {
      const { sha, data } = await getJson(f.path);
      return { ...data, id: f.name.replace(/\.json$/, ""), _sha: sha, _path: f.path };
    }))).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }
  async function loadOrders() {
    const api = checkoutApi();
    if (!api) { S.orders = null; return; }
    try {
      const res = await fetch(`${api}/api/admin/orders`, { headers: { authorization: `Bearer ${S.token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Orders unavailable (${res.status})`);
      S.orders = data.orders || []; S.ordersError = data.note || "";
    } catch (e) { S.orders = []; S.ordersError = e.message; }
  }

  // ---------- login ----------
  async function renderLogin(message = "") {
    const api = checkoutApi();
    let oauth = false;
    if (api) { try { oauth = (await (await fetch(`${api}/`)).json()).login; } catch { oauth = false; } }
    const err = el("p", { class: "err", text: message });
    const input = el("input", { type: "password", id: "token", placeholder: "Paste your GitHub token", autocomplete: "off", required: true });
    const form = el("form", { onsubmit: async (e) => { e.preventDefault(); err.textContent = ""; await signIn(input.value.trim(), err); } },
      el("label", { class: "sr", for: "token", text: "GitHub token" }), input,
      el("button", { class: "btn block", type: "submit" }, "Log in"),
      el("p", { class: "help" }, "Create one at GitHub → Settings → Developer settings → Fine-grained tokens, with access to ", el("b", { text: "SruthiArts" }), " and ", el("b", { text: "Contents: Read and write" }), "."));
    app.replaceChildren(el("main", { class: "login" }, el("div", { class: "login-card" },
      logo("h1"),
      el("p", { text: "Your studio. Post new pieces, update stock and see orders." }),
      oauth ? el("button", { class: "btn gh block", type: "button", onclick: () => oauthLogin(api, err) }, icon("gh"), "Continue with GitHub") : null,
      oauth ? el("div", { class: "or", text: "or" }) : null,
      oauth ? el("details", {}, el("summary", { text: "Use an access token" }), form) : form,
      err,
      el("p", { class: "help" }, el("a", { href: "../", text: "← Back to the shop" }), " · ", el("a", { href: "classic/", text: "Classic editor" })))));
  }
  function oauthLogin(api, err) {
    const origin = new URL(api).origin;
    const w = window.open(`${api}/auth?provider=github&scope=public_repo`, "sa-login", "width=520,height=680");
    if (!w) { err.textContent = "Allow pop-ups for this page, then try again."; return; }
    const onMsg = async (e) => {
      if (e.origin !== origin || typeof e.data !== "string") return;
      if (e.data === "authorizing:github") { e.source.postMessage("authorizing:github", e.origin); return; }
      const m = e.data.match(/^authorization:github:(success|error):(.*)$/s);
      if (!m) return;
      window.removeEventListener("message", onMsg);
      const payload = JSON.parse(m[2] || "{}");
      if (m[1] === "success") await signIn(payload.token, err); else err.textContent = payload.message || "Login failed.";
    };
    window.addEventListener("message", onMsg);
  }
  async function signIn(token, err) {
    S.token = token;
    try {
      const [user, repo] = await Promise.all([gh("/user"), gh(`/repos/${REPO}`)]);
      if (!repo.permissions || !repo.permissions.push) throw new Error("This GitHub account can't edit the SruthiArts repo.");
      S.user = user;
      try { localStorage.setItem(TOKEN_KEY, token); } catch {}
      await start();
    } catch (e) { S.token = ""; S.user = null; if (err) err.textContent = e.message; }
  }
  function signOut(message) {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    S.token = ""; S.user = null;
    renderLogin(message || "");
  }

  // ---------- shell ----------
  async function start() {
    app.replaceChildren(skeleton());
    await loadAll();
    render();
    loadOrders().then(() => { renderNavBadges(); if (S.tab === "orders") renderView(); });
  }
  function skeleton() {
    return el("div", {}, el("div", { class: "topbar" }, logo()),
      el("div", { class: "shell" }, el("div", { class: "profile" }, el("div", { class: "avatar" }, el("div", { class: "skeleton" })), el("div", {}, el("div", { class: "skeleton", style: "height:18px;width:60%;border-radius:6px" }))),
        el("div", { class: "grid", style: "margin-top:16px" }, Array.from({ length: 9 }, () => el("div", { class: "tile skeleton" })))));
  }
  const TABS = [
    { id: "posts", label: "Posts", icon: "grid" },
    { id: "orders", label: "Orders", icon: "bag" },
    { id: "page", label: "Page", icon: "text" },
    { id: "settings", label: "Settings", icon: "gear" },
  ];
  function setTab(id) {
    if (S.tab === id) return;
    if (S.dirty && !confirmLeave()) return;
    S.tab = id; S.dirty = false;
    render(true);
    window.scrollTo({ top: Math.min(window.scrollY, document.querySelector(".tabs").offsetTop - 56), behavior: "smooth" });
  }
  function confirmLeave() { toast("Save or discard your changes first.", "err"); return false; }

  function render(keepScroll) {
    const y = window.scrollY;
    const avail = S.items.filter((i) => stockOf(i) > 0).length;
    const sold = S.items.length - avail;
    const avatarSrc = (S.pages && S.pages.about && S.pages.about.photo) || (S.items[0] && S.items[0].image);
    const tabIndex = TABS.findIndex((t) => t.id === S.tab);
    app.replaceChildren(
      el("header", { class: "topbar" },
        logo(),
        el("span", { id: "publish-slot" }),
        el("span", {},
          el("a", { class: "icon-btn", href: "../", target: "_blank", rel: "noopener", title: "View shop", "aria-label": "View shop" }, icon("eye")),
          el("button", { class: "icon-btn", title: "New post", "aria-label": "New post", onclick: () => openComposer() }, icon("plus")))),
      el("div", { class: "shell" },
        el("section", { class: "profile" },
          el("div", { class: "avatar" }, avatarSrc ? el("img", { src: imgUrl(avatarSrc), alt: "" }) : el("div", { text: (S.settings.name || "S")[0] })),
          el("div", { class: "who" },
            el("h1", { text: "Sruthi Arts" }),
            el("p", { text: [S.settings.name, S.settings.instagram ? `@${S.settings.instagram.replace(/^@/, "")}` : ""].filter(Boolean).join(" · ") || "Your shop" }),
            el("div", { class: "stats" },
              el("div", {}, el("b", { text: String(S.items.length) }), el("span", { text: "posts" })),
              el("div", {}, el("b", { text: String(avail) }), el("span", { text: "available" })),
              el("div", {}, el("b", { text: String(sold) }), el("span", { text: "sold" })))),
          el("div", { class: "profile-actions" },
            el("button", { class: "btn", onclick: () => openComposer() }, "New post"),
            el("button", { class: "btn light", onclick: () => setTab("page") }, "Edit page"),
            el("a", { class: "btn light", href: "../", target: "_blank", rel: "noopener" }, "View shop"))),
        el("nav", { class: "tabs", role: "tablist" },
          TABS.map((t) => el("button", { role: "tab", "aria-selected": String(t.id === S.tab), onclick: () => setTab(t.id) }, icon(t.icon), t.label)),
          el("span", { class: "bar", style: `transform:translateX(${tabIndex * 100}%)` })),
        el("div", { id: "view" })),
      el("nav", { class: "bottomnav", "aria-label": "Studio" },
        el("button", { "aria-label": "Posts", "aria-current": S.tab === "posts" ? "page" : null, onclick: () => setTab("posts") }, icon("grid")),
        el("button", { "aria-label": "Orders", "aria-current": S.tab === "orders" ? "page" : null, onclick: () => setTab("orders"), id: "nav-orders" }, icon("bag")),
        el("button", { class: "plus", "aria-label": "New post", onclick: () => openComposer() }, icon("plus")),
        el("button", { "aria-label": "Page text", "aria-current": S.tab === "page" ? "page" : null, onclick: () => setTab("page") }, icon("text")),
        el("button", { "aria-label": "Settings", "aria-current": S.tab === "settings" ? "page" : null, onclick: () => setTab("settings") }, icon("gear"))));
    renderView();
    renderPublish();
    renderNavBadges();
    if (keepScroll) window.scrollTo(0, y);
  }
  function renderNavBadges() {
    const btn = document.getElementById("nav-orders");
    if (!btn) return;
    btn.querySelector(".dot")?.remove();
    const n = (S.orders || []).filter((o) => o.status !== "shipped").length;
    if (n) btn.append(el("span", { class: "dot", text: String(n) }));
  }
  function renderView() {
    const view = document.getElementById("view");
    if (!view) return;
    const v = S.tab === "posts" ? postsView() : S.tab === "orders" ? ordersView() : S.tab === "page" ? pageView() : settingsView();
    view.replaceChildren(el("div", { class: "view" }, v));
  }

  // ---------- Posts ----------
  function postsView() {
    const list = S.items.filter((i) => S.filter === "all" || (S.filter === "sold" ? stockOf(i) === 0 : i.category === S.filter));
    const chips = el("div", { class: "chips" },
      [{ id: "all", label: "All" }, ...CATS, { id: "sold", label: "Sold" }].map((c) =>
        el("button", { class: "chip", "aria-pressed": String(S.filter === c.id), onclick: () => { S.filter = c.id; renderView(); } }, c.label)));
    if (!S.items.length) return el("div", {}, emptyState("Share your first piece", "Tap + to post a photo. It appears in the shop about a minute later.", "New post", () => openComposer()));
    if (!list.length) return el("div", {}, chips, el("p", { class: "empty", text: "Nothing here yet." }));
    return el("div", {}, chips, el("div", { class: "grid" }, list.map((it, i) => tile(it, i))));
  }
  function tile(it, i) {
    const left = stockOf(it);
    const im = el("img", { src: it._blob || imgUrl(it.image), alt: "", loading: i < 9 ? "eager" : "lazy", onload: (e) => e.target.classList.add("ok"), onerror: (e) => e.target.classList.add("broken") });
    return el("button", { class: `tile${left === 0 ? " is-sold" : ""}${it._new ? " new" : ""}`, style: `--i:${Math.min(i, 15)}`, "aria-label": `${it.title}, ${left ? `${left} available` : "sold"}`, onclick: () => openPost(it) },
      im,
      left === 0 ? el("span", { class: "badge sold", text: "Sold" }) : left > 1 ? el("span", { class: "badge", text: `×${left}` }) : null,
      el("span", { class: "price-tag", text: money(it.price) }));
  }
  function emptyState(title, text, action, fn) {
    return el("div", { class: "empty" }, el("div", { class: "ring" }, icon("photo")), el("h2", { text: title }), el("p", { text: text }), action ? el("button", { class: "btn", onclick: fn }, action) : null);
  }

  // ---------- Sheets ----------
  function sheet(content, { full = false, onClose } = {}) {
    const wrap = el("div", { class: "sheet-wrap", role: "dialog", "aria-modal": "true" });
    const box = el("div", { class: `sheet${full ? " full" : ""}` }, el("div", { class: "grabber", "aria-hidden": "true" }), content);
    wrap.append(box);
    const close = () => {
      if (wrap.classList.contains("closing")) return;
      wrap.classList.add("closing");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => { wrap.remove(); document.documentElement.style.overflow = ""; onClose && onClose(); }, 220);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    document.addEventListener("keydown", onKey);
    // Drag the sheet down to dismiss (phones)
    let sy = 0, dy = 0, dragging = false;
    box.addEventListener("touchstart", (e) => { sy = e.touches[0].clientY; dragging = box.scrollTop <= 0; dy = 0; }, { passive: true });
    box.addEventListener("touchmove", (e) => { if (!dragging) return; dy = Math.max(0, e.touches[0].clientY - sy); if (dy > 6) { box.style.transform = `translateY(${dy}px)`; box.style.transition = "none"; } }, { passive: true });
    box.addEventListener("touchend", () => { box.style.transition = "transform .25s"; if (dy > 120) close(); else box.style.transform = ""; dragging = false; });
    document.body.append(wrap);
    document.documentElement.style.overflow = "hidden";
    return { close, box };
  }
  const head = (title, left, right) => el("div", { class: "sheet-head" }, left || el("span"), el("h2", { text: title }), right || el("span"));

  function openPost(it) {
    let qty = stockOf(it);
    const out = el("output", { text: String(qty) });
    const saveStock = el("button", { class: "btn", hidden: true, onclick: () => update({ quantity: qty, status: qty > 0 ? "available" : "sold" }, qty > 0 ? `Stock updated: ${qty} available` : "Marked as sold") }, "Save stock");
    const bump = (d) => { qty = Math.max(0, Math.min(999, qty + d)); out.textContent = String(qty); out.classList.remove("bump"); void out.offsetWidth; out.classList.add("bump"); saveStock.hidden = qty === stockOf(it); };
    const confirmBox = el("div", { class: "confirm", hidden: true },
      el("p", { text: `Delete “${it.title}”? It disappears from the shop. This can't be undone here.` }),
      el("div", { class: "two" }, el("button", { class: "btn light", onclick: () => (confirmBox.hidden = true) }, "Keep it"), el("button", { class: "btn danger", onclick: () => remove() }, "Delete")));
    const s = sheet(el("div", {},
      head(it.title, el("button", { class: "txt plain", onclick: () => s.close() }, "Close"), el("button", { class: "txt", onclick: () => { s.close(); setTimeout(() => openComposer(it), 230); } }, "Edit")),
      el("div", { class: "post-media" }, el("img", { src: it._blob || imgUrl(it.image), alt: it.alt || it.title })),
      el("div", { class: "post-meta" },
        el("h3", { text: `${it.title} · ${money(it.price)}` }),
        it.description ? el("p", { class: "cap", text: it.description }) : null,
        el("p", { class: "meta", text: `${catLabel(it.category)} · ${it.medium || ""} · ${it.width || "?"} × ${it.height || "?"} cm` })),
      el("div", { class: "stock-card" },
        el("div", {}, el("b", { text: "Available" }), el("small", { text: "Goes down by itself after each PayPal sale" })),
        el("div", { class: "stepper" }, el("button", { "aria-label": "One fewer", onclick: () => bump(-1) }, "−"), out, el("button", { "aria-label": "One more", onclick: () => bump(1) }, "+"))),
      el("div", { class: "post-actions" },
        saveStock,
        el("div", { class: "two" },
          stockOf(it) > 0 ? el("button", { class: "btn light", onclick: () => update({ quantity: 0, status: "sold" }, "Marked as sold") }, "Mark as sold")
            : el("button", { class: "btn light", onclick: () => update({ quantity: 1, status: "available" }, "Back in the shop") }, "Relist (1 available)"),
          el("a", { class: "btn light", href: `../#${it.id}`, target: "_blank", rel: "noopener" }, "View on site")),
        el("button", { class: "btn ghost", onclick: () => { confirmBox.hidden = false; confirmBox.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }, "Delete post"),
        confirmBox)));

    async function update(patch, msg) {
      try {
        const { sha, data } = await getJson(it._path); // fresh copy: a sale may have changed stock
        const next = { ...data, ...patch };
        const r = await putJson(it._path, next, `Admin: update ${it.id}`, sha);
        Object.assign(it, next, { _sha: r.content.sha });
        toast(msg); s.close(); render(true);
      } catch (e) { toast(e.message, "err"); }
    }
    async function remove() {
      try {
        await deleteFile(it._path, it._sha, `Admin: remove ${it.id}`);
        S.items = S.items.filter((x) => x !== it);
        toast("Post deleted"); s.close(); render(true);
      } catch (e) { toast(e.message, "err"); }
    }
  }

  // ---------- Photo processing: fix rotation, shrink to web size, convert to WebP (JPEG on older Safari) ----------
  async function processImage(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Choose a photo (JPG, PNG, HEIC or WebP).");
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("This photo format isn't supported by your browser. Try a JPG.")); i.src = URL.createObjectURL(file); }); }
    const scale = Math.min(1, 1600 / bmp.width, 2000 / bmp.height);
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    let blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.85));
    if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return { blob, url: URL.createObjectURL(blob), ext: blob.type === "image/webp" ? "webp" : "jpg" };
  }

  // ---------- Composer (new post / edit post) ----------
  function openComposer(existing) {
    const editing = Boolean(existing);
    const d = editing
      ? { ...existing }
      : { title: "", description: "", category: S.filter && CATS.some((c) => c.id === S.filter) ? S.filter : "originals", price: "", quantity: 1, medium: "Acrylic on canvas", width: "", height: "", alt: "" };
    let photo = null; // { blob, url, ext }
    const shareBtn = el("button", { class: "txt", disabled: !editing, onclick: () => share() }, editing ? "Save" : "Share");
    const body = el("div");
    const s = sheet(el("div", {}, head(editing ? "Edit post" : "New post", el("button", { class: "txt plain", onclick: () => s.close() }, "Cancel"), shareBtn), body), { full: true });
    const fileInput = el("input", { type: "file", accept: "image/*", hidden: true, onchange: (e) => pick(e.target.files[0]) });

    async function pick(file) {
      if (!file) return;
      try { photo = await processImage(file); d._preview = photo.url; showForm(); }
      catch (e) { toast(e.message, "err"); }
    }
    function showPicker() {
      const zone = el("label", { class: "picker" }, icon("photo"), el("h3", { text: "Drag a photo here" }), el("p", { text: "or" }), el("span", { class: "btn" }, "Select from your device"), fileInput);
      ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
      ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
      zone.addEventListener("drop", (e) => pick(e.dataTransfer.files[0]));
      body.replaceChildren(zone);
    }
    function showForm() {
      shareBtn.disabled = false;
      const qOut = el("output", { text: String(d.quantity ?? 1) });
      const qBump = (n) => { d.quantity = Math.max(0, Math.min(999, Number(d.quantity || 0) + n)); qOut.textContent = String(d.quantity); qOut.classList.remove("bump"); void qOut.offsetWidth; qOut.classList.add("bump"); };
      const bind = (key, attrs = {}) => el(attrs.tag || "input", { ...attrs, tag: null, value: d[key] ?? "", oninput: (e) => { d[key] = e.target.value; } });
      const catChips = el("div", { class: "cat-chips" }, CATS.map((c) => el("button", { type: "button", class: "chip", "aria-pressed": String(d.category === c.id), onclick: (e) => { d.category = c.id; [...catChips.children].forEach((b) => b.setAttribute("aria-pressed", "false")); e.currentTarget.setAttribute("aria-pressed", "true"); } }, c.label)));
      body.replaceChildren(
        el("div", { class: "preview" }, el("img", { src: d._preview || d._blob || imgUrl(d.image), alt: "" }), el("button", { class: "swap", type: "button", onclick: () => fileInput.click() }, "Change photo"), fileInput),
        el("div", { class: "sheet-body" },
          el("label", { class: "field" }, el("span", { text: "Title" }), bind("title", { type: "text", placeholder: "e.g. Rose Lantern", maxlength: 80 })),
          el("label", { class: "field" }, el("span", { text: "Caption" }), bind("description", { tag: "textarea", placeholder: "Write a caption… what inspired it, colours, story" })),
          el("div", { class: "field" }, el("span", { text: "Category" }), catChips),
          el("div", { class: "row2" },
            el("label", { class: "field" }, el("span", { text: `Price (${S.settings.currency || "CAD"})` }), bind("price", { type: "number", inputmode: "decimal", min: 0, step: "1", placeholder: "249" })),
            el("div", { class: "field" }, el("span", { text: "Quantity" }), el("div", { class: "stepper" }, el("button", { type: "button", "aria-label": "One fewer", onclick: () => qBump(-1) }, "−"), qOut, el("button", { type: "button", "aria-label": "One more", onclick: () => qBump(1) }, "+")))),
          el("label", { class: "field" }, el("span", { text: "Medium" }), el("select", { onchange: (e) => (d.medium = e.target.value) }, MEDIUMS.map((m) => el("option", { value: m, selected: d.medium === m ? true : null, text: m })))),
          el("div", { class: "row2" },
            el("label", { class: "field" }, el("span", { text: "Width (cm)" }), bind("width", { type: "number", inputmode: "numeric", min: 1, placeholder: "40" })),
            el("label", { class: "field" }, el("span", { text: "Height (cm)" }), bind("height", { type: "number", inputmode: "numeric", min: 1, placeholder: "50" }))),
          el("label", { class: "field" }, el("span", { text: "Photo description" }), bind("alt", { type: "text", placeholder: "What the photo shows (read aloud to blind visitors)" }), el("small", { text: "Optional. If empty, the title is used." })),
          el("div", { class: "progress", hidden: true, id: "progress" }, el("i")),
          el("button", { class: "btn block", type: "button", onclick: () => share() }, editing ? "Save changes" : "Share to shop")));
    }
    async function share() {
      const title = String(d.title || "").trim();
      const price = Number(d.price);
      if (!title) return toast("Add a title first.", "err");
      if (!(price > 0)) return toast("Add a price.", "err");
      if (!editing && !photo) return toast("Choose a photo.", "err");
      const width = Math.max(1, Math.round(Number(d.width) || 1)), height = Math.max(1, Math.round(Number(d.height) || 1));
      const prog = document.getElementById("progress"); const bar = prog && prog.firstChild;
      const setP = (p) => { if (prog) { prog.hidden = false; bar.style.width = `${p}%`; } };
      shareBtn.disabled = true;
      try {
        let id = editing ? existing.id : slugify(title) || `item-${Date.now().toString(36)}`;
        if (!editing) { let n = 2; const base = id; while (S.items.some((x) => x.id === id)) id = `${base}-${n++}`; }
        let image = editing ? existing.image : "";
        setP(15);
        if (photo) {
          const file = `${id}-${Date.now().toString(36)}.${photo.ext}`;
          await putFile(`site/images/paintings/${file}`, await blobToB64(photo.blob), `Admin: upload photo for ${id}`);
          image = `images/paintings/${file}`;
        }
        setP(65);
        const qty = Math.max(0, Math.round(Number(d.quantity ?? 1)));
        const item = {
          ...(editing ? stripPrivate(existing) : {}),
          title, category: d.category, image, alt: String(d.alt || "").trim() || title,
          description: String(d.description || "").trim() || title, medium: d.medium || MEDIUMS[0], width, height, price,
          quantity: qty, status: qty > 0 ? "available" : "sold", date: editing ? existing.date || nowLocal() : nowLocal(),
        };
        const path = `content/items/${id}.json`;
        const r = await putJson(path, item, `Admin: ${editing ? "update" : "add"} ${id}`, editing ? (await getJson(path)).sha : undefined);
        setP(100);
        const saved = { ...item, id, _sha: r.content.sha, _path: path, _new: !editing };
        if (photo) { saved.image = image; saved._blob = photo.url; }
        S.items = editing ? S.items.map((x) => (x === existing ? saved : x)) : [saved, ...S.items];
        body.replaceChildren(el("div", { class: "done-burst" }, el("span", { html: ICON.heart }), el("h3", { text: editing ? "Saved!" : "Shared!" }), el("p", { text: "It will appear in the shop in about a minute." })));
        setTimeout(() => { s.close(); S.tab = "posts"; S.filter = "all"; render(); setTimeout(() => { saved._new = false; }, 1000); }, 1500);
      } catch (e) { shareBtn.disabled = false; toast(e.message, "err"); setP(0); }
    }
    if (editing) showForm(); else { showPicker(); setTimeout(() => fileInput.click(), 350); }
  }
  const stripPrivate = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_") && k !== "id"));

  // ---------- Orders ----------
  function ordersView() {
    if (!checkoutApi()) return emptyState("Orders appear here", "Once PayPal checkout is connected (Settings → Checkout), every sale shows up here with the buyer's address, and Sruthi gets a WhatsApp alert.", "Open settings", () => setTab("settings"));
    if (S.orders === null) return el("div", { class: "orders" }, Array.from({ length: 3 }, () => el("div", { class: "order skeleton", style: "height:110px" })));
    const wrap = el("div", { class: "orders" });
    if (S.ordersError) wrap.append(el("p", { class: "warn", text: S.ordersError }));
    if (!S.orders.length) { wrap.append(emptyState("No orders yet", "When someone buys through PayPal, the order appears here.")); return wrap; }
    S.orders.forEach((o, i) => {
      const it = S.items.find((x) => x.id === o.itemId);
      const addr = [o.shipTo && o.shipTo.name, o.shipTo && o.shipTo.address].filter(Boolean).join(", ");
      wrap.append(el("article", { class: "order", style: `--i:${i}` },
        el("img", { src: it ? imgUrl(it.image) : "", alt: "" }),
        el("div", {},
          el("h3", { text: `${o.title} ×${o.quantity}` }),
          el("p", { text: `${o.amount} ${o.currency} · ${new Date(o.createdAt).toLocaleString()}` }),
          el("p", { class: "muted", text: `${o.buyer && o.buyer.name || "Buyer"}${o.buyer && o.buyer.email ? ` · ${o.buyer.email}` : ""}` }),
          el("p", { text: addr || "No address from PayPal" })),
        o.stockError ? el("p", { class: "warn", style: "grid-column:1/-1", text: `Stock wasn't updated automatically (${o.stockError}). Adjust it on the post.` }) : null,
        el("div", { class: "foot" },
          el("span", { class: `pill${o.status === "shipped" ? " shipped" : ""}`, text: o.status === "shipped" ? "Shipped" : "To ship" }),
          el("span", {},
            addr ? el("button", { class: "btn light", style: "min-height:38px;margin-right:6px", onclick: async () => { try { await navigator.clipboard.writeText(`${addr}`); toast("Address copied"); } catch { toast("Couldn't copy — select the text instead", "err"); } } }, "Copy address") : null,
            el("button", { class: `btn${o.status === "shipped" ? " light" : ""}`, style: "min-height:38px", onclick: () => setOrder(o, o.status === "shipped" ? "new" : "shipped") }, o.status === "shipped" ? "Undo" : "Mark shipped")))));
    });
    return wrap;
  }
  async function setOrder(o, status) {
    try {
      const res = await fetch(`${checkoutApi()}/api/admin/orders/${encodeURIComponent(o.key)}`, { method: "PATCH", headers: { authorization: `Bearer ${S.token}`, "content-type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update the order");
      o.status = status; toast(status === "shipped" ? "Marked as shipped 📦" : "Moved back to To ship"); renderView(); renderNavBadges();
    } catch (e) { toast(e.message, "err"); }
  }

  // ---------- Page text ----------
  function pageView() {
    const draft = S.pageDraft || (S.pageDraft = JSON.parse(JSON.stringify(S.pages || {})));
    ["hero", "about", "buy", "contact", "footer"].forEach((k) => (draft[k] = draft[k] || {}));
    draft.buy.steps = draft.buy.steps || [];
    const saveBar = el("div", { class: "savebar", hidden: !S.dirty }, el("button", { class: "btn light", style: "min-width:auto;margin-right:8px", onclick: () => { S.pageDraft = null; S.dirty = false; renderView(); } }, "Discard"), el("button", { class: "btn", onclick: () => savePages() }, "Save changes"));
    const dirty = () => { S.dirty = true; saveBar.hidden = false; };
    const inp = (obj, key, label, opts = {}) => el("label", { class: "field" }, el("span", { text: label }),
      el(opts.area ? "textarea" : "input", { type: opts.area ? null : "text", value: obj[key] || "", placeholder: opts.ph || "", oninput: (e) => { obj[key] = e.target.value; dirty(); } }),
      opts.hint ? el("small", { text: opts.hint }) : null);
    const aboutPhoto = el("div", { class: "photo-field" },
      draft.about.photo ? el("img", { src: imgUrl(draft.about.photo), alt: "" }) : el("div", { class: "ph" }),
      el("label", { class: "btn light" }, draft.about.photo ? "Change photo" : "Add a photo", el("input", { type: "file", accept: "image/*", hidden: true, onchange: async (e) => {
        try {
          const ph = await processImage(e.target.files[0]);
          toast("Uploading photo…");
          const file = `about-${Date.now().toString(36)}.${ph.ext}`;
          await putFile(`site/images/paintings/${file}`, await blobToB64(ph.blob), "Admin: upload about photo");
          draft.about.photo = `images/paintings/${file}`; dirty(); renderView();
        } catch (err) { toast(err.message, "err"); }
      } })),
      draft.about.photo ? el("button", { class: "btn ghost", onclick: () => { draft.about.photo = ""; dirty(); renderView(); } }, "Remove") : null);
    const steps = el("div", { class: "steps-edit" }, draft.buy.steps.map((st, i) => el("div", { class: "step-edit" },
      el("button", { class: "rm", "aria-label": "Remove step", onclick: () => { draft.buy.steps.splice(i, 1); dirty(); renderView(); } }, "×"),
      inp(st, "title", `Step ${i + 1}`), inp(st, "text", "Details", { area: true }))));
    return el("div", { class: "forms" },
      el("section", { class: "card", style: "--i:0" }, el("h2", { text: "Top of the page" }),
        inp(draft.hero, "eyebrow", "Small line above the headline"), inp(draft.hero, "title", "Headline"), inp(draft.hero, "titleAccent", "Headline — pink italic part"), inp(draft.hero, "intro", "Intro", { area: true })),
      el("section", { class: "card", style: "--i:1" }, el("h2", { text: "About the artist" }), inp(draft.about, "heading", "Heading"), inp(draft.about, "text", "Text", { area: true, hint: "Leave an empty line between paragraphs." }), aboutPhoto),
      el("section", { class: "card", style: "--i:2" }, el("h2", {}, "How to buy ", el("small", { text: "— update when PayPal checkout goes live" })), inp(draft.buy, "heading", "Heading"), steps,
        el("button", { class: "btn light", onclick: () => { draft.buy.steps.push({ title: "", text: "" }); dirty(); renderView(); } }, "+ Add a step")),
      el("section", { class: "card", style: "--i:3" }, el("h2", { text: "Contact section" }), inp(draft.contact, "heading", "Heading"), inp(draft.contact, "text", "Text", { area: true })),
      el("section", { class: "card", style: "--i:4" }, el("h2", { text: "Footer" }), inp(draft.footer, "text", "Footer text")),
      saveBar);
  }
  async function savePages() {
    try {
      const { sha } = await getJson("content/pages.json");
      const r = await putJson("content/pages.json", S.pageDraft, "Admin: update page text", sha);
      S.pages = JSON.parse(JSON.stringify(S.pageDraft)); S.pagesSha = r.content.sha; S.dirty = false;
      toast("Page text saved"); render(true);
    } catch (e) { toast(e.message, "err"); }
  }

  // ---------- Settings ----------
  function settingsView() {
    const d = S.setDraft || (S.setDraft = { ...S.settings });
    const saveBar = el("div", { class: "savebar", hidden: !S.dirty }, el("button", { class: "btn light", style: "min-width:auto;margin-right:8px", onclick: () => { S.setDraft = null; S.dirty = false; renderView(); } }, "Discard"), el("button", { class: "btn", onclick: () => saveSettings() }, "Save settings"));
    const dirty = () => { S.dirty = true; saveBar.hidden = false; };
    const inp = (key, label, attrs = {}, hint) => el("label", { class: "field" }, el("span", { text: label }), el("input", { type: "text", ...attrs, value: d[key] || "", oninput: (e) => { d[key] = e.target.value.trim(); dirty(); } }), hint ? el("small", { text: hint }) : null);
    const status = el("div", { class: "cat-chips" });
    const test = async () => {
      status.replaceChildren(el("span", { class: "pill", text: "Checking…" }));
      try {
        const h = await (await fetch(`${(d.checkoutApi || "").replace(/\/+$/, "")}/`)).json();
        const chip = (ok, label) => el("span", { class: `pill${ok ? " shipped" : ""}`, text: `${ok ? "✓" : "✗"} ${label}` });
        status.replaceChildren(chip(h.checkout, `PayPal (${h.paypalEnv})`), chip(h.orders, "Orders storage"), chip(h.whatsapp, "WhatsApp alerts"), chip(h.login, "GitHub login"));
      } catch { status.replaceChildren(el("span", { class: "pill", text: "Can't reach the server. Check the URL." })); }
    };
    return el("div", { class: "forms" },
      el("section", { class: "card", style: "--i:0" }, el("h2", { text: "Shop" }),
        inp("name", "Artist name"), inp("instagram", "Instagram username", { placeholder: "sruthi_artss" }, "Without the @."),
        inp("email", "Email (optional)", { type: "email" }),
        el("label", { class: "field" }, el("span", { text: "Currency" }), el("select", { onchange: (e) => { d.currency = e.target.value; dirty(); } }, CURRENCIES.map((c) => el("option", { value: c, selected: (d.currency || "CAD") === c ? true : null, text: c }))))),
      el("section", { class: "card", style: "--i:1" }, el("h2", { text: "Checkout" }),
        inp("checkoutApi", "Checkout server URL", { type: "url", placeholder: "https://sruthiarts-checkout.<you>.workers.dev" }, "Leave empty until the checkout server is set up (docs/SETUP.md)."),
        inp("paypalClientId", "PayPal client ID", {}, "Public ID from developer.paypal.com. With the server URL, this turns on the PayPal buttons and automatic stock updates."),
        inp("paypal", "PayPal.me username", { placeholder: "SruthirikaKoora" }, "Just the name after paypal.me/, without @. Used for the Buy button until checkout is set up."),
        el("button", { class: "btn light", onclick: test }, "Test connection"), status),
      el("section", { class: "card", style: "--i:2" }, el("h2", { text: "Account" }),
        el("p", { style: "margin:0", text: S.user ? `Signed in as @${S.user.login}` : "" }),
        el("div", { class: "two", style: "display:flex;gap:8px;flex-wrap:wrap" },
          el("button", { class: "btn light", onclick: () => signOut("Signed out.") }, "Sign out"),
          el("a", { class: "btn light", href: "classic/" }, "Classic editor"))),
      saveBar);
  }
  async function saveSettings() {
    try {
      const { sha } = await getJson("content/settings.json");
      const clean = Object.fromEntries(Object.entries(S.setDraft).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
      clean.instagram = (clean.instagram || "").replace(/^@/, "");
      clean.paypal = (clean.paypal || "").replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/^paypal\.me\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
      if (clean.checkoutApi) {
        let ok = false;
        try { const u = new URL(clean.checkoutApi); ok = u.protocol === "https:" && !/(^|\.)paypal\.(me|com)$/i.test(u.hostname); } catch {}
        if (!ok) return toast("Checkout server URL should be your Cloudflare Worker address (https://…workers.dev), not a PayPal link. Leave it empty until checkout is set up.", "err");
      }
      if (clean.paypalClientId && !/^[A-Za-z0-9_-]{40,}$/.test(clean.paypalClientId)) return toast("PayPal client ID is the long code from developer.paypal.com → Apps & Credentials, not a username. Leave it empty until checkout is set up.", "err");
      if (clean.checkoutApi && !clean.paypalClientId) return toast("Add the PayPal client ID too, or clear the checkout server URL.", "err");
      const r = await putJson("content/settings.json", clean, "Admin: update settings", sha);
      S.settings = clean; S.settingsSha = r.content.sha; S.dirty = false;
      toast("Settings saved"); render(true);
      loadOrders().then(renderNavBadges);
    } catch (e) { toast(e.message, "err"); }
  }

  // ---------- boot ----------
  (async function boot() {
    try { S.site = (await (await fetch("../data/shop.json", { cache: "no-cache" })).json()).artist || {}; } catch { S.site = {}; }
    let saved = "";
    try { saved = localStorage.getItem(TOKEN_KEY) || ""; } catch {}
    if (saved) { app.replaceChildren(skeleton()); await signIn(saved, null); if (!S.user) renderLogin("Please log in again."); }
    else renderLogin();
  })();
  window.addEventListener("beforeunload", (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
})();
