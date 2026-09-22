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

  const state = { paintings: [], artist: {}, filter: "All", current: -1 };
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
    const media = ["All", ...new Set(state.paintings.map((p) => p.medium))];
    const wrap = $("#filters");
    wrap.replaceChildren(
      ...media.map((m) =>
        el("button", {
          type: "button",
          "aria-pressed": String(m === state.filter),
          text: m,
          onclick: () => { state.filter = m; renderFilters(); renderWall(); },
        })
      )
    );
    wrap.hidden = media.length <= 2;
  }

  function renderWall() {
    const list = state.paintings
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => state.filter === "All" || p.medium === state.filter);
    $("#wall").replaceChildren(
      ...list.map(({ p, idx }, i) =>
        el("li", { class: "piece", style: `--i:${i}` },
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

  function renderContact() {
    const { email, instagram } = state.artist;
    const body = $("#contact-body");
    const parts = [el("p", { text: "Every painting is an original. Send the name of the piece you like and where you are, and Sruthi will reply with shipping or pickup options." })];
    if (email) {
      parts.push(el("div", { class: "address" }, el("code", { text: email }), copyButton(email)));
      parts.push(el("p", {}, el("a", { class: "btn", href: mailto("Painting enquiry") }, "Email Sruthi")));
    }
    if (instagram) {
      const handle = instagram.replace(/^@/, "");
      parts.push(el("p", {}, "Or message on Instagram: ", el("a", { href: `https://instagram.com/${handle}`, rel: "noopener", target: "_blank" }, `@${handle}`)));
    }
    if (!email && !instagram) parts.push(el("p", { text: "Contact details are on their way. Check back soon." }));
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
      actions.push(state.artist.email
        ? el("a", { class: "btn", href: mailto(`Enquiry: ${p.title}`) }, "Enquire about this painting")
        : el("a", { class: "btn", href: "#contact", onclick: () => viewer.close() }, "Enquire about this painting"));
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
      renderHero(); renderFilters(); renderWall(); renderContact(); openFromHash();
    })
    .catch(() => {
      $("#wall").replaceChildren(el("li", { class: "note", text: "The paintings couldn’t load. Refresh the page to try again." }));
    });
})();
