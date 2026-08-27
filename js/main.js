/* main.js — bootstrap. Runs last, once every module has registered itself. */
(function () {
  'use strict';

  // The logo shows both characters; the favicon stays a single one. At 16px a
  // 62-cell-wide pair is an unreadable smudge, so the tab keeps the cat alone.
  RG.icon.mount(RG.el.logo, { pair: true, favicon: false });
  RG.icon.setFavicon(RG.icon.dataUri());

  // The stage can still measure 0 at script time (fonts/layout not settled, or the
  // page laid out in a hidden tab), so re-measure after layout and on full load.
  RG.render.resize();
  requestAnimationFrame(RG.render.resize);
  window.addEventListener('load', RG.render.resize);
})();
