/* main.js — bootstrap. Runs last, once every module has registered itself. */
(function () {
  'use strict';

  // Only the cat is generated; the panda beside it is artwork placed in the
  // markup. Mounting into #logoCat rather than #logo matters — mount() replaces
  // the host's contents, so mounting into the wrapper would wipe the panda out.
  RG.icon.mount(RG.el.logoCat);

  // The stage can still measure 0 at script time (fonts/layout not settled, or
  // the page laid out in a hidden tab), so re-measure after layout and on load.
  RG.render.resize();
  requestAnimationFrame(RG.render.resize);
  window.addEventListener('load', RG.render.resize);
})();
