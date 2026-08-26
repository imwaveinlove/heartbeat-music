/* main.js — bootstrap. Runs last, once every module has registered itself. */
(function () {
  'use strict';

  // The stage can still measure 0 at script time (fonts/layout not settled, or the
  // page laid out in a hidden tab), so re-measure after layout and on full load.
  RG.render.resize();
  requestAnimationFrame(RG.render.resize);
  window.addEventListener('load', RG.render.resize);
})();
