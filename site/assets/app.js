// Sruthi Arts — renders the gallery from data/paintings.json.
// To add a painting: drop the image in images/paintings/ and add an entry to the JSON. No code changes needed.
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    children.flat().forEach((c) => c && node.append(c));
    return node;
  };

  // Shop categories, in menu order. The "id" is what paintings.json stores in each item's "category".
  const CATEGORIES = [
    { id: "all", label: "All" },
    { id: "ludo-boards", label: "Ludo boards" },
    { id: "clocks", label: "Clocks" },
    { id: "originals", label: "Originals" },
    { id: "prints", label: "Prints" },
  ];
  const state = { paintings: [], artist: {}, filter: "all", current: -1 };
  let money = (n) => `$${n}`;

  const spec = (p) => `${p.medium} · ${p.width} × ${p.height} cm`;
  const isSold = (p) => p.status === "sold";

  function renderHero() {
    const p = state.paintings.find((x) => !isSold(x)) || state.paintings[0];
    if (!p) return;
    const fig = $("#hero-art");
    fig.replaceChildren(el("div", { class: "frame" }, el("img", { src: p.image, alt: "", width: "800", height: "1000" })));
  }

  function renderFilters() {
    const count = (id) => (id === "all" ? state.paintings.length : state.paintings.filter((p) => p.category === id).length);
    $("#filters").replaceChildren(
      ...CATEGORIES.map((c) =>
        el("button", {
          type: "button",
          "aria-pressed": String(c.id === state.filter),
          onclick: () => { state.filter = c.id; renderFilters(); renderWall(); },
        }, c.label, el("span", { class: "count", text: String(count(c.id)) }))
      )
    );
  }

  function renderWall() {
    const list = state.paintings
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => state.filter === "all" || p.category === state.filter);
    if (!list.length) {
      const label = CATEGORIES.find((c) => c.id === state.filter)?.label.toLowerCase() || "pieces";
      const empty = el("li", { class: "empty" }, el("p", { text: `No ${label} listed right now.` }));
      if (igHandle()) empty.append(el("p", {}, el("a", { href: igUrl(), target: "_blank", rel: "noopener" }, `Follow @${igHandle()}`), " for new pieces, or message to ask about one."));
      $("#wall").replaceChildren(empty);
      return;
    }
    $("#wall").replaceChildren(
      ...list.map(({ p, idx }, i) =>
        el("li", { class: `piece${isSold(p) ? " is-sold" : ""}`, style: `--i:${i}` },
          el("button", { type: "button", "aria-label": `View ${p.title}`, onclick: () => open(idx) },
            el("div", { class: "frame" },
              el("img", { src: p.image, alt: p.alt || p.title, loading: i < 2 ? "eager" : "lazy", width: "800", height: "1000" })
            )
          ),
          el("div", { class: "label" },
            el("h3", { text: p.title }),
            el("p", { class: "label-spec", text: spec(p) }),
            el("div", { class: "label-row" },
              el("span", { class: "price", text: isSold(p) ? "—" : money(p.price) }),
              el("span", { class: `status${isSold(p) ? " sold" : ""}`, text: isSold(p) ? "Sold" : "Available" })
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

  // PayPal.me link with the price filled in, or a per-painting PayPal link if one is set.
  function paypalUrl(p) {
    if (p.paypalLink) return p.paypalLink;
    const user = (state.artist.paypal || "").replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/\/.*$/, "").trim();
    return user ? `https://www.paypal.me/${user}/${p.price}${state.artist.currency || "CAD"}` : "";
  }

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
    if (!state.artist.paypal) {
      const [, two, three] = document.querySelectorAll(".steps li");
      if (two) two.replaceChildren(el("strong", { text: "Message Sruthi" }), el("span", { text: `Send the painting’s name to @${h} on Instagram to reserve it.` }));
      if (three) three.replaceChildren(el("strong", { text: "Pay and receive it" }), el("span", { text: "Sruthi replies with payment details and arranges delivery." }));
    }
  }

  function renderContact() {
    const { email } = state.artist;
    const body = $("#contact-body");
    const parts = [el("p", { text: "For questions about a piece, custom commissions or delivery, message Sruthi directly." })];
    const links = el("div", { class: "contact-links" });
    if (igHandle()) links.append(iconLink("btn", igUrl(), IG_ICON, `Message @${igHandle()}`));
    if (email) links.append(el("a", { class: "btn ghost", href: mailto("Painting enquiry") }, "Email Sruthi"));
    if (links.childElementCount) parts.push(links);
    if (email) parts.push(el("div", { class: "address" }, el("code", { text: email }), copyButton(email)));
    if (!email && !igHandle()) parts.push(el("p", { text: "Contact details are on their way. Check back soon." }));
    body.replaceChildren(...parts);
  }

  // Viewer (deep-linkable via #painting-id)
  const viewer = $("#viewer");
  function open(idx, { push = true } = {}) {
    const p = state.paintings[idx];
    if (!p) return;
    state.current = idx;
    $("#viewer-img").src = p.image;
    $("#viewer-img").alt = p.alt || p.title;
    $("#viewer-artist").textContent = state.artist.name || "Sruthi";
    $("#viewer-title").textContent = p.title;
    $("#viewer-spec").textContent = spec(p);
    $("#viewer-desc").textContent = p.description;
    $("#viewer-price").textContent = isSold(p) ? "Sold — in a private collection" : money(p.price);
    const actions = [];
    if (!isSold(p)) {
      const pay = paypalUrl(p);
      if (pay) {
        actions.push(iconLink("btn paypal", pay, PP_ICON, `Buy with PayPal · ${money(p.price)}`));
        if (igHandle()) actions.push(iconLink("btn ghost", igUrl(), IG_ICON, "Ask a question on Instagram"));
        actions.push(el("p", { class: "fine", text: igHandle()
          ? `After paying, message @${igHandle()} with “${p.title}” and your address so Sruthi can arrange delivery.`
          : `After paying, Sruthi will contact you through PayPal to arrange delivery.` }));
      } else if (igHandle()) {
        actions.push(iconLink("btn", igUrl(), IG_ICON, "Buy on Instagram"));
        actions.push(el("p", { class: "fine", text: `Message @${igHandle()} with “${p.title}” to reserve it.` }));
      } else if (state.artist.email) {
        actions.push(el("a", { class: "btn", href: mailto(`Enquiry: ${p.title}`) }, "Enquire about this painting"));
      }
    }
    $("#viewer-actions").replaceChildren(...actions);
    if (!viewer.open) viewer.showModal();
    if (push && location.hash !== `#${p.id}`) history.replaceState(null, "", `#${p.id}`);
    document.title = `${p.title} · Sruthi Arts`;
  }
  const step = (d) => open((state.current + d + state.paintings.length) % state.paintings.length);
  $("#viewer-prev").addEventListener("click", () => step(-1));
  $("#viewer-next").addEventListener("click", () => step(1));
  $("#viewer-close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (e) => { if (e.target === viewer) viewer.close(); });
  viewer.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); });
  viewer.addEventListener("close", () => {
    document.title = "Sruthi Arts";
    if (state.paintings.some((p) => `#${p.id}` === location.hash)) history.replaceState(null, "", location.pathname + location.search);
  });

  function openFromHash() {
    const idx = state.paintings.findIndex((p) => `#${p.id}` === location.hash);
    if (idx >= 0) open(idx, { push: false });
  }
  window.addEventListener("hashchange", openFromHash);

  $("#year").textContent = new Date().getFullYear();

  fetch("data/paintings.json")
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      state.paintings = data.paintings || [];
      state.artist = data.artist || {};
      const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: state.artist.currency || "CAD", maximumFractionDigits: 0 });
      money = (n) => fmt.format(n);
      applyInstagram(); renderHero(); renderFilters(); renderWall(); renderContact(); openFromHash();
    })
    .catch(() => {
      $("#wall").replaceChildren(el("li", { class: "note", text: "The paintings couldn’t load. Refresh the page to try again." }));
    });
})();
