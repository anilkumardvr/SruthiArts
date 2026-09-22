// Fairy-dust pointer trail. Mouse/trackpad only, skipped when the visitor prefers reduced motion,
// and the animation loop sleeps whenever there is no dust on screen.
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!matchMedia("(pointer: fine)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.id = "fairy-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const colors = ["#e0789c", "#c8927a", "#f7b6cb"];
  const dots = [];
  let dpr = 1, running = false, last = 0;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  addEventListener("pointermove", (e) => {
    const now = performance.now();
    if (now - last < 16) return; // at most one burst per frame
    last = now;
    for (let i = 0; i < 3; i++) {
      dots.push({
        x: e.clientX * dpr + (Math.random() * 8 - 4) * dpr,
        y: e.clientY * dpr + (Math.random() * 8 - 4) * dpr,
        r: (0.8 + Math.random() * 1.8) * dpr,
        a: 0.9,
        vx: (Math.random() - 0.5) * 0.5 * dpr,
        vy: (Math.random() - 0.2) * 0.6 * dpr,
        c: colors[(Math.random() * colors.length) | 0],
      });
    }
    if (dots.length > 240) dots.splice(0, dots.length - 240);
    if (!running) { running = true; requestAnimationFrame(tick); }
  }, { passive: true });

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = dots.length - 1; i >= 0; i--) {
      const d = dots[i];
      d.x += d.vx; d.y += d.vy; d.a *= 0.95; d.r *= 0.992;
      if (d.a < 0.04) { dots.splice(i, 1); continue; }
      ctx.globalAlpha = d.a;
      ctx.fillStyle = d.c;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (dots.length) requestAnimationFrame(tick);
    else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
})();
