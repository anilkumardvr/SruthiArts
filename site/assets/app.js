// Sruthi Arts — renders the shop and page text from data/shop.json and runs PayPal checkout.
// shop.json is built from content/ by scripts/build-data.mjs; edit content through /admin, not this file.
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    children.flat().forEach((c) => c !== null && c !== undefined && c !== false && node.append(c));
    return node;
  };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isPhone = () => matchMedia("(max-width: 700px)").matches;

  // Shop categories, in menu order. The "id" is what each item's "category" stores.
  const CATEGORIES = [
    { id: "all", label: "All" },
    { id: "ludo-boards", label: "Ludo boards" },
    { id: "clocks", label: "Clocks" },
    { id: "originals", label: "Originals" },
    { id: "prints", label: "Prints" },
  ];
  const state = { paintings: [], artist: {}, pages: null, filter: "all", current: -1, qty: 1 };
  let money = (n) => `$${n}`;

  const spec = (p) => `${p.medium} · ${p.width} × ${p.height} cm`;
  const stockOf = (p) => (p.status === "sold" ? 0 : Number.isFinite(Number(p.quantity)) ? Math.max(0, Number(p.quantity)) : 1);
  const isSold = (p) => stockOf(p) === 0;
  const stockLabel = (p) => { const n = stockOf(p); return n === 0 ? "Sold out" : `${n} available`; };
  const stockClass = (p) => (stockOf(p) === 0 ? "sold" : "ok");

  // Images fade in once decoded; a failed image shows the mat instead of a broken icon.
  function img(attrs) {
    const node = el("img", { decoding: "async", ...attrs });
    const done = () => node.classList.add("is-loaded");
    node.addEventListener("load", done, { once: true });
    node.addEventListener("error", () => { node.classList.add("is-broken"); done(); }, { once: true });
    if (node.complete && node.naturalWidth) done();
    return node;
  }

  function renderHero() {
    const p = state.paintings.find((x) => !isSold(x)) || state.paintings[0];
    if (!p) return;
    $("#hero-art").replaceChildren(el("div", { class: "frame tilt" }, img({ src: p.image, alt: "", width: "800", height: "1000" })));
  }

  function renderFilters() {
    const count = (id) => (id === "all" ? state.paintings.length : state.paintings.filter((p) => p.category === id).length);
    $("#filters").replaceChildren(
      ...CATEGORIES.map((c) =>
        el("button", {
          type: "button",
          "aria-pressed": String(c.id === state.filter),
          onclick: (e) => {
            state.filter = c.id; renderFilters(); renderWall();
            e.currentTarget && e.currentTarget.scrollIntoView && e.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
          },
        }, c.label, el("span", { class: "count", text: String(count(c.id)) }))
      )
    );
  }

  function renderWall() {
    const list = state.paintings
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => state.filter === "all" || p.category === state.filter);
    const wall = $("#wall");
    wall.classList.remove("is-swapping"); void wall.offsetWidth; wall.classList.add("is-swapping");
    if (!list.length) {
      const label = CATEGORIES.find((c) => c.id === state.filter)?.label.toLowerCase() || "pieces";
      const empty = el("li", { class: "empty" }, el("p", { text: `No ${label} listed right now.` }));
      if (igHandle()) empty.append(el("p", {}, el("a", { href: igUrl(), target: "_blank", rel: "noopener" }, `Follow @${igHandle()}`), " for new pieces, or message to ask about one."));
      wall.replaceChildren(empty);
      return;
    }
    wall.replaceChildren(
      ...list.map(({ p, idx }, i) =>
        el("li", { class: `piece${isSold(p) ? " is-sold" : ""}`, style: `--i:${Math.min(i, 12)}` },
          el("button", { type: "button", "aria-label": `View ${p.title}, ${stockLabel(p)}`, onclick: () => open(idx) },
            el("div", { class: "frame" },
              img({ src: p.image, alt: p.alt || p.title, loading: i < 4 ? "eager" : "lazy", width: "800", height: "1000" }),
              isSold(p) ? el("span", { class: "ribbon", text: "Sold" }) : null
            )
          ),
          el("div", { class: "label" },
            el("h3", { text: p.title }),
            el("p", { class: "label-spec", text: spec(p) }),
            el("div", { class: "label-row" },
              el("span", { class: "price", text: isSold(p) ? "—" : money(p.price) }),
              el("span", { class: `status ${stockClass(p)}`, text: stockLabel(p) })
            )
          )
        )
      )
    );
  }

  function copyButton(text) {
    const btn = el("button", { type: "button", class: "copy", text: "Copy" });
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; }
      catch { const r = document.createRange(); r.selectNodeContents(btn.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); btn.textContent = "Selected — press Ctrl+C"; }
      setTimeout(() => (btn.textContent = "Copy"), 2200);
    });
    return btn;
  }

  function mailto(subject) {
    return `mailto:${state.artist.email}?subject=${encodeURIComponent(subject)}`;
  }
  const igHandle = () => (state.artist.instagram || "").replace(/^@/, "").trim();
  const igUrl = () => `https://www.instagram.com/${igHandle()}/`;
  const IG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none"/></svg>';
  const PP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7.3 21H4.1a.5.5 0 0 1-.5-.6L6.4 3.5A.6.6 0 0 1 7 3h6.4c3.3 0 5.3 1.7 4.8 4.8-.6 3.6-3 5.3-6.4 5.3H9.9a.6.6 0 0 0-.6.5L8.4 19.3"/><path d="M19.6 8.6c.9.8 1.2 2 .9 3.6-.6 3.4-2.9 4.9-6 4.9h-1.2a.6.6 0 0 0-.6.5l-.7 3.8a.5.5 0 0 1-.5.4H9.3" opacity=".6"/></svg>';

  // Fallback when checkout isn't set up: PayPal.me link with the price filled in, or a per-item PayPal link.
  function paypalUrl(p) {
    if (p.paypalLink) return p.paypalLink;
    const user = (state.artist.paypal || "").replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/^paypal\.me\//i, "").trim().replace(/^@/, "").replace(/[/?#].*$/, "");
    return user ? `https://www.paypal.me/${user}/${p.price}${state.artist.currency || "CAD"}` : "";
  }
  const checkoutOn = () => /^https:\/\//.test(state.artist.checkoutApi || "") && !/paypal\.(me|com)/i.test(state.artist.checkoutApi) && /^[A-Za-z0-9_-]{40,}$/.test(state.artist.paypalClientId || "");
  const api = (path) => state.artist.checkoutApi.replace(/\/+$/, "") + path;

  function iconLink(cls, href, icon, label) {
    const a = el("a", { class: cls, href, target: "_blank", rel: "noopener" });
    a.innerHTML = icon;
    a.append(" " + label);
    return a;
  }

  function applyInstagram() {
    const h = igHandle();
    document.querySelectorAll("[data-ig]").forEach((a) => { if (h) a.href = igUrl(); else a.hidden = true; });
    document.querySelectorAll("[data-ig-handle]").forEach((n) => (n.textContent = `@${h}`));
  }

  // Page text from content/pages.json. The HTML carries the same defaults, so the page reads fine before this runs.
  const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  function renderPages() {
    const pages = state.pages;
    if (!pages) return;
    document.querySelectorAll("[data-content]").forEach((n) => {
      const v = get(pages, n.dataset.content);
      if (typeof v === "string" && v.trim()) n.textContent = v;
    });
    const about = pages.about || {};
    if (about.text) $("#about-body").replaceChildren(...about.text.split(/\n\s*\n/).map((para) => el("p", { text: para.trim() })));
    const photo = $("#about-photo");
    if (about.photo) { photo.src = about.photo; photo.alt = about.photoAlt || `Photo of ${state.artist.name || "the artist"}`; photo.hidden = false; }
    splitHeadline();
  }

  // Headline words rise in one by one.
  function splitHeadline() {
    if (reduceMotion) return;
    let d = 0;
    document.querySelectorAll("#hero-title [data-content]").forEach((part) => {
      const words = part.textContent.trim().split(/\s+/);
      part.replaceChildren(...words.flatMap((w, i) => [el("span", { class: "w", style: `--d:${d++}`, text: w }), i < words.length - 1 ? " " : ""]));
    });
  }

  function renderContact() {
    const { email } = state.artist;
    const intro = (state.pages && state.pages.contact && state.pages.contact.text) || "For questions about a piece, custom commissions or delivery, message Sruthi directly.";
    const parts = [el("p", { text: intro })];
    const links = el("div", { class: "contact-links" });
    if (igHandle()) links.append(iconLink("btn", igUrl(), IG_ICON, `Message @${igHandle()}`));
    if (email) links.append(el("a", { class: "btn ghost", href: mailto("Painting enquiry") }, "Email Sruthi"));
    if (links.childElementCount) parts.push(links);
    if (email) parts.push(el("div", { class: "address" }, el("code", { text: email }), copyButton(email)));
    if (!email && !igHandle()) parts.push(el("p", { text: "Contact details are on their way. Check back soon." }));
    $("#contact-body").replaceChildren(...parts);
  }

  // ---------- PayPal checkout ----------
  let sdkPromise = null;
  function loadPayPal() {
    if (window.paypal) return Promise.resolve(window.paypal);
    if (!sdkPromise) {
      sdkPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(state.artist.paypalClientId)}&currency=${encodeURIComponent(state.artist.currency || "CAD")}&intent=capture&components=buttons`;
        s.onload = () => resolve(window.paypal);
        s.onerror = () => { sdkPromise = null; reject(new Error("PayPal didn't load")); };
        document.head.append(s);
      });
    }
    return sdkPromise;
  }

  async function postJson(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || "Something went wrong. You have not been charged."); err.data = data; throw err; }
    return data;
  }

  function checkoutBlock(p) {
    const left = stockOf(p);
    state.qty = 1;
    const note = el("p", { class: "checkout-msg", role: "status" });
    const total = el("span", { class: "total", text: money(p.price) });
    const qtyRow = left > 1
      ? el("div", { class: "qty" },
          el("span", { text: "Quantity" }),
          el("div", { class: "stepper" },
            el("button", { type: "button", "aria-label": "One fewer", onclick: () => setQty(-1) }, "−"),
            el("output", { id: "qty-out", text: "1" }),
            el("button", { type: "button", "aria-label": "One more", onclick: () => setQty(1) }, "+")),
          total)
      : null;
    function setQty(d) {
      state.qty = Math.max(1, Math.min(left, 20, state.qty + d));
      $("#qty-out").textContent = String(state.qty);
      total.textContent = money(p.price * state.qty);
      const out = $("#qty-out"); out.classList.remove("bump"); void out.offsetWidth; out.classList.add("bump");
    }
    const box = el("div", { class: "paypal-box", id: "paypal-buttons" }, el("div", { class: "pp-skeleton" }, el("span"), el("span")));
    const wrap = el("div", { class: "checkout" }, qtyRow, box, note, el("p", { class: "fine", text: "Secure checkout by PayPal. Pay with your PayPal account or any debit or credit card. Your delivery address comes from PayPal." }));

    loadPayPal().then((paypal) => {
      box.replaceChildren();
      paypal.Buttons({
        style: { layout: "vertical", shape: "pill", color: "gold", label: "pay", height: 48 },
        createOrder: async () => {
          note.textContent = ""; note.className = "checkout-msg";
          try { return (await postJson(api("/api/orders"), { itemId: p.id, quantity: state.qty })).id; }
          catch (e) { note.textContent = e.message; note.className = "checkout-msg error"; throw e; }
        },
        onApprove: async (data, actions) => {
          note.textContent = "Confirming your payment…"; note.className = "checkout-msg";
          try {
            const r = await postJson(api(`/api/orders/${data.orderID}/capture`));
            celebrate(p, r);
          } catch (e) {
            if (e.data && e.data.restart) { note.textContent = e.message; note.className = "checkout-msg error"; return actions.restart(); }
            note.textContent = e.message; note.className = "checkout-msg error";
          }
        },
        onCancel: () => { note.textContent = "Checkout cancelled. Nothing was charged."; note.className = "checkout-msg"; },
        onError: () => { if (!note.textContent) { note.textContent = "PayPal hit a problem. Please try again in a moment."; note.className = "checkout-msg error"; } },
      }).render(box);
    }).catch(() => {
      box.replaceChildren();
      const fallback = paypalUrl(p);
      note.className = "checkout-msg error";
      note.textContent = "Checkout couldn't load. Check your connection and reopen this piece" + (igHandle() ? `, or message @${igHandle()} to buy it.` : ".");
      if (fallback) box.append(iconLink("btn paypal", fallback, PP_ICON, `Pay with PayPal · ${money(p.price)}`));
    });
    return wrap;
  }

  function celebrate(p, result) {
    const idx = state.paintings.indexOf(p);
    const left = typeof result.stockLeft === "number" ? result.stockLeft : Math.max(0, stockOf(p) - (result.quantity || 1));
    state.paintings[idx] = { ...p, quantity: left, status: left > 0 ? "available" : "sold" };
    renderFilters(); renderWall();
    const thanks = el("div", { class: "thanks" },
      el("div", { class: "tick", "aria-hidden": "true" }),
      el("h3", { text: "Thank you!" }),
      el("p", { text: `Your payment for “${result.title || p.title}” went through. Sruthi has been notified and will ship it to the address on your PayPal account.` }),
      igHandle() ? el("p", {}, "Questions? Message ", el("a", { href: igUrl(), target: "_blank", rel: "noopener" }, `@${igHandle()}`), ".") : null,
      el("button", { type: "button", class: "btn ghost", onclick: () => closeViewer() }, "Keep browsing"));
    $("#viewer-actions").replaceChildren(thanks);
    thanks.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    $("#viewer-stock").textContent = stockLabel(state.paintings[idx]);
    $("#viewer-stock").className = `stock ${stockClass(state.paintings[idx])}`;
    petals();
  }

  // A short burst of petals — the one celebratory moment on the site.
  function petals() {
    if (reduceMotion) return;
    const c = el("canvas", { class: "petals", "aria-hidden": "true" });
    document.body.append(c);
    const ctx = c.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const colors = ["#e0789c", "#f7b6cb", "#c8927a", "#a8325e", "#fde6ec"];
    const bits = Array.from({ length: 90 }, () => ({ x: innerWidth / 2 * dpr, y: innerHeight * 0.55 * dpr, vx: (Math.random() - 0.5) * 16 * dpr, vy: (-Math.random() * 16 - 6) * dpr, r: (4 + Math.random() * 5) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0] }));
    let t = 0;
    (function frame() {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const b of bits) {
        b.vy += 0.45 * dpr; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.globalAlpha = Math.max(0, 1 - t / 110);
        ctx.beginPath(); ctx.ellipse(0, 0, b.r, b.r * 0.55, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      if (++t < 120) requestAnimationFrame(frame); else c.remove();
    })();
  }

  // ---------- Viewer (bottom sheet on phones, dialog on larger screens) ----------
  const viewer = $("#viewer");
  function open(idx, { push = true } = {}) {
    const p = state.paintings[idx];
    if (!p) return;
    const dir = state.current === -1 || !viewer.open ? 0 : idx > state.current ? 1 : -1;
    state.current = idx;
    const vimg = $("#viewer-img");
    vimg.classList.remove("is-loaded", "slide-l", "slide-r");
    if (dir) { void vimg.offsetWidth; vimg.classList.add(dir > 0 ? "slide-l" : "slide-r"); }
    vimg.onload = () => vimg.classList.add("is-loaded");
    vimg.src = p.image;
    if (vimg.complete && vimg.naturalWidth) vimg.classList.add("is-loaded");
    vimg.alt = p.alt || p.title;
    $("#viewer-artist").textContent = state.artist.name || "Sruthi";
    $("#viewer-title").textContent = p.title;
    $("#viewer-spec").textContent = spec(p);
    $("#viewer-desc").textContent = p.description;
    $("#viewer-price").textContent = isSold(p) ? "Sold — in a private collection" : money(p.price);
    $("#viewer-stock").textContent = isSold(p) ? "" : stockLabel(p);
    $("#viewer-stock").className = `stock ${stockClass(p)}`;

    const actions = [];
    if (!isSold(p)) {
      if (checkoutOn()) {
        actions.push(checkoutBlock(p));
        if (igHandle()) actions.push(iconLink("btn ghost small", igUrl(), IG_ICON, "Ask a question on Instagram"));
      } else if (paypalUrl(p)) {
        actions.push(iconLink("btn paypal", paypalUrl(p), PP_ICON, `Buy with PayPal · ${money(p.price)}`));
        if (igHandle()) actions.push(iconLink("btn ghost", igUrl(), IG_ICON, "Ask a question on Instagram"));
        actions.push(el("p", { class: "fine", text: igHandle()
          ? `After paying, message @${igHandle()} with “${p.title}” and your address so Sruthi can arrange delivery.`
          : "After paying, Sruthi will contact you through PayPal to arrange delivery." }));
      } else if (igHandle()) {
        actions.push(iconLink("btn", igUrl(), IG_ICON, "Buy on Instagram"));
        actions.push(el("p", { class: "fine", text: `Message @${igHandle()} with “${p.title}” to reserve it.` }));
      } else if (state.artist.email) {
        actions.push(el("a", { class: "btn", href: mailto(`Enquiry: ${p.title}`) }, "Enquire about this piece"));
      }
    } else if (igHandle()) {
      actions.push(el("p", { class: "fine" }, "Love this one? ", el("a", { href: igUrl(), target: "_blank", rel: "noopener" }, `Message @${igHandle()}`), " about similar pieces or a commission."));
    }
    $("#viewer-actions").replaceChildren(...actions);
    if (!viewer.open) {
      viewer.classList.remove("is-closing");
      viewer.showModal();
      document.documentElement.classList.add("sheet-open");
    }
    $("#viewer-inner").scrollTop = 0;
    if (push && location.hash !== `#${p.id}`) history.replaceState(null, "", `#${p.id}`);
    document.title = `${p.title} · Sruthi Arts`;
  }

  function closeViewer() {
    if (!viewer.open || viewer.classList.contains("is-closing")) return;
    if (reduceMotion) return viewer.close();
    viewer.classList.add("is-closing");
    setTimeout(() => { viewer.close(); viewer.classList.remove("is-closing"); $("#viewer-inner").style.transform = ""; }, 240);
  }

  const step = (d) => open((state.current + d + state.paintings.length) % state.paintings.length);
  $("#viewer-prev").addEventListener("click", () => step(-1));
  $("#viewer-next").addEventListener("click", () => step(1));
  $("#viewer-close").addEventListener("click", closeViewer);
  viewer.addEventListener("click", (e) => { if (e.target === viewer) closeViewer(); });
  viewer.addEventListener("cancel", (e) => { e.preventDefault(); closeViewer(); });
  viewer.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); });
  viewer.addEventListener("close", () => {
    document.documentElement.classList.remove("sheet-open");
    document.title = "Sruthi Arts";
    state.current = -1;
    if (state.paintings.some((p) => `#${p.id}` === location.hash)) history.replaceState(null, "", location.pathname + location.search);
  });

  // Touch gestures: swipe the photo left/right to browse; drag the sheet down to close (phones).
  (function gestures() {
    const inner = $("#viewer-inner"), art = $("#viewer-art");
    let sx = 0, sy = 0, dy = 0, mode = "";
    inner.addEventListener("touchstart", (e) => {
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY; dy = 0;
      mode = isPhone() && inner.scrollTop <= 0 ? "maybe-drag" : "";
    }, { passive: true });
    inner.addEventListener("touchmove", (e) => {
      const t = e.touches[0], mx = t.clientX - sx, my = t.clientY - sy;
      if (mode === "maybe-drag" && my > 8 && Math.abs(my) > Math.abs(mx)) mode = "drag";
      if (mode === "drag") { dy = Math.max(0, my); inner.style.transform = `translateY(${dy}px)`; inner.style.transition = "none"; }
    }, { passive: true });
    inner.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0], mx = t.clientX - sx, my = t.clientY - sy;
      if (mode === "drag") {
        inner.style.transition = "";
        if (dy > 110) closeViewer(); else inner.style.transform = "";
      } else if (art.contains(e.target) && Math.abs(mx) > 50 && Math.abs(mx) > Math.abs(my) * 1.5) {
        step(mx < 0 ? 1 : -1);
      }
      mode = "";
    });
  })();

  function openFromHash() {
    const idx = state.paintings.findIndex((p) => `#${p.id}` === location.hash);
    if (idx >= 0) open(idx, { push: false });
  }
  window.addEventListener("hashchange", openFromHash);

  // Gentle 3D tilt on the hero painting for mouse users.
  (function tilt() {
    if (reduceMotion || !matchMedia("(pointer: fine)").matches) return;
    const hero = $(".hero");
    hero.addEventListener("pointermove", (e) => {
      const f = hero.querySelector(".tilt"); if (!f) return;
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      f.style.transform = `perspective(900px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
    });
    hero.addEventListener("pointerleave", () => { const f = hero.querySelector(".tilt"); if (f) f.style.transform = ""; });
  })();

  // Depth on scroll: the hero painting drifts slower than the page; framed pieces lean toward the cursor.
  (function depth() {
    if (reduceMotion) return;
    const art = $("#hero-art");
    let ticking = false;
    addEventListener("scroll", () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => { const y = Math.min(scrollY, 900); art.style.translate = `0 ${y * 0.12}px`; ticking = false; });
    }, { passive: true });
    if (!matchMedia("(pointer: fine)").matches) return;
    const wall = $("#wall");
    wall.addEventListener("pointermove", (e) => {
      const f = e.target.closest(".piece .frame"); if (!f) return;
      const r = f.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      f.style.transform = `perspective(700px) translateY(-4px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg)`;
    });
    wall.addEventListener("pointerout", (e) => { const f = e.target.closest && e.target.closest(".piece .frame"); if (f && !f.contains(e.relatedTarget)) f.style.transform = ""; });
  })();

  // Highlight the tab bar item for the section in view (phones).
  (function tabbar() {
    const links = [...document.querySelectorAll(".tabbar a[href^='#']")];
    if (!("IntersectionObserver" in window) || !links.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${en.target.id}`)); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["gallery", "about", "contact"].forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  })();

  $("#year").textContent = new Date().getFullYear();

  // "no-cache" makes the browser check for a newer copy every visit, so admin edits show up right after each deploy.
  fetch("data/shop.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      state.paintings = data.paintings || [];
      state.artist = data.artist || {};
      state.pages = data.pages || null;
      const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: state.artist.currency || "CAD", maximumFractionDigits: 2, minimumFractionDigits: 0 });
      money = (n) => fmt.format(n);
      applyInstagram(); renderPages(); renderHero(); renderFilters(); renderWall(); renderContact(); openFromHash();
    })
    .catch(() => {
      $("#wall").replaceChildren(el("li", { class: "note", text: "The shop couldn’t load. Refresh the page to try again." }));
    });
})();
