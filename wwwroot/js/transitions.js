
(function(){
  const root = document.getElementById('transition-root');
  if(!root) return;

  // Add enter animation on load
  root.classList.add('zoom-enter');
  // Overlay element (optional)
  let overlay = document.querySelector('.page-overlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.className = 'page-overlay';
    document.body.appendChild(overlay);
  }

  // Helper: is internal link we should animate
  function isInternalLink(a){
    if(!a || a.target === '_blank' || a.hasAttribute('download')) return false;
    const href = a.getAttribute('href');
    if(!href) return false;
    if(href.startsWith('#')) return false;
    const url = new URL(href, location.href);
    return url.origin === location.origin;
  }

  // Intercept clicks on links
  document.addEventListener('click', function(e){
    const a = e.target.closest('a');
    if(!a || !isInternalLink(a)) return;

    e.preventDefault();
    const goto = a.href;

    // leave animation
    overlay.classList.add('active');
    root.classList.remove('zoom-enter');
    root.classList.add('zoom-leave');

    const duration = 400; // stay in sync with CSS
    setTimeout(()=>{ window.location.href = goto; }, duration);
  }, true);

  // Support back/forward cache restoring
  window.addEventListener('pageshow', (evt)=>{
    if(evt.persisted){
      root.classList.remove('zoom-leave');
      root.classList.add('zoom-enter');
      overlay.classList.remove('active');
    }
  });
})();