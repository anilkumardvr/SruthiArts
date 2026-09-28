import * as React from "react";

import { reduceMotion } from "@/lib/shop";

// A short burst of petals — the one celebratory moment on the site.
export function petals() {
  if (reduceMotion()) return;
  const c = document.createElement("canvas");
  c.setAttribute("aria-hidden", "true");
  c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:100";
  document.body.append(c);
  const ctx = c.getContext("2d");
  if (!ctx) return c.remove();
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const colors = ["#e0789c", "#f7b6cb", "#c8927a", "#a8325e", "#fde6ec"];
  const bits = Array.from({ length: 90 }, () => ({
    x: (innerWidth / 2) * dpr, y: innerHeight * 0.55 * dpr,
    vx: (Math.random() - 0.5) * 16 * dpr, vy: (-Math.random() * 16 - 6) * dpr,
    r: (4 + Math.random() * 5) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
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

// Fairy-dust pointer trail. Mouse/trackpad only, skipped when the visitor prefers reduced motion,
// and the animation loop sleeps whenever there is no dust on screen.
export function FairyDust() {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    if (reduceMotion() || !matchMedia("(pointer: fine)").matches) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const colors = ["#e0789c", "#c8927a", "#f7b6cb"];
    const dots: { x: number; y: number; r: number; a: number; vx: number; vy: number; c: string }[] = [];
    let dpr = 1, running = false, last = 0, raf = 0;
    const resize = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    };
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = dots.length - 1; i >= 0; i--) {
        const d = dots[i];
        d.x += d.vx; d.y += d.vy; d.a *= 0.95; d.r *= 0.992;
        if (d.a < 0.04) { dots.splice(i, 1); continue; }
        ctx.globalAlpha = d.a; ctx.fillStyle = d.c;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (dots.length) raf = requestAnimationFrame(tick);
      else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    };
    const move = (e: PointerEvent) => {
      const now = performance.now();
      if (now - last < 16) return; // at most one burst per frame
      last = now;
      for (let i = 0; i < 3; i++) {
        dots.push({ x: e.clientX * dpr + (Math.random() * 8 - 4) * dpr, y: e.clientY * dpr + (Math.random() * 8 - 4) * dpr, r: (0.8 + Math.random() * 1.8) * dpr, a: 0.9, vx: (Math.random() - 0.5) * 0.5 * dpr, vy: (Math.random() - 0.2) * 0.6 * dpr, c: colors[(Math.random() * colors.length) | 0] });
      }
      if (dots.length > 240) dots.splice(0, dots.length - 240);
      if (!running) { running = true; raf = requestAnimationFrame(tick); }
    };
    resize();
    addEventListener("resize", resize);
    addEventListener("pointermove", move, { passive: true });
    return () => { removeEventListener("resize", resize); removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] h-screen w-screen" />;
}
