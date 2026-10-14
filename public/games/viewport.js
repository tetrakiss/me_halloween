'use strict';
(function () {
  const stage = document.getElementById('stage');
  const viewport = document.getElementById('viewport');
  let scheduled = false;
  function fit() {
    scheduled = false;
    const visual = window.visualViewport;
    const width = Math.max(1, Math.min(viewport.clientWidth, visual ? visual.width : viewport.clientWidth));
    const height = Math.max(1, Math.min(viewport.clientHeight, visual ? visual.height : viewport.clientHeight));
    const scale = Math.min(width / 1920, height / 1080);
    // Scale from the top-left corner. Unscaled layout is clipped by a fixed viewport,
    // so TV browsers cannot create scrollbars from the 1920px artwork box.
    stage.style.transform = 'scale(' + scale + ')';
    stage.style.left = Math.max(0, (width - 1920 * scale) / 2) + 'px';
    stage.style.top = Math.max(0, (height - 1080 * scale) / 2) + 'px';
    stage.style.setProperty('--scale', scale);
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(fit); }
  }
  window.fitGameViewport = fit;
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('fullscreenchange', schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule);
    window.visualViewport.addEventListener('scroll', schedule);
  }
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(viewport);
  fit();
})();
