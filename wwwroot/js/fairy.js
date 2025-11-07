(() => {
  const canvas = document.createElement('canvas');
  canvas.id = 'fairy-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const DPR = Math.max(1, window.devicePixelRatio || 1);
  let w, h;
  const dots = [];

  function resize() {
    w = canvas.width = innerWidth * DPR;
    h = canvas.height = innerHeight * DPR;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
  }
  resize();
  addEventListener('resize', resize);

  addEventListener('mousemove', e => {
    for (let i = 0; i < 4; i++) {
      dots.push({
        x: e.clientX * DPR + (Math.random() * 8 - 4),
        y: e.clientY * DPR + (Math.random() * 8 - 4),
        r: 1 + Math.random() * 2,
        a: 0.9,
        vx: (Math.random() - .5) * 0.6,
        vy: (Math.random() - .8) * 0.6
      });
    }
  });

  function tick() {
    ctx.clearRect(0,0,w,h);
    for (let i = dots.length - 1; i >= 0; i--) {
      const d = dots[i];
      d.x += d.vx; d.y += d.vy; d.a *= 0.96; d.r *= 0.995;
      if (d.a < 0.05 || d.y < -50 || d.x < -50 || d.x > w+50) { dots.splice(i,1); continue; }
      ctx.beginPath();
      ctx.globalAlpha = d.a;
      ctx.fillStyle = '#b388ff'; // soft fairy purple
      ctx.arc(d.x, d.y, d.r, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(tick);
  }
  tick();
})();
