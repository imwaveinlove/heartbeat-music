/* icon.js — the heartbeat♡ mascot, drawn as pixel art from a character grid.
 *
 * Kept as a grid rather than a binary image so it scales to any size, stays
 * editable, and needs no file alongside the page. Rendered to an SVG data URI for
 * the favicon and injected inline as a logo.
 *
 * Standalone: this file has no dependencies and can be dropped into any project.
 *
 *   <script src="icon.js"></script>
 *   <script>
 *     HeartbeatIcon.mount(document.getElementById('logo'));         // logo + favicon
 *     HeartbeatIcon.mount(el, { favicon: false });                  // logo only
 *     HeartbeatIcon.mount(el, { colors: { P: '#000', W: '#fff' } }); // recoloured
 *     img.src = HeartbeatIcon.dataUri();                            // as an image
 *   </script>
 *
 * It also registers itself as RG.icon when that namespace exists, which is how
 * this game uses it.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    P: '#ff2e88',   // hot pink outline
    W: '#ffffff',   // white head
    H: '#ffb3d9',   // light pink heart face
    G: '#c7cbd9',   // headphone cup
    D: '#9aa0b4'    // headphone shade
  };

  // 36 x 22. '.' is transparent.
  // Columns 0-5 and 30-35 are the wings; the cat head and heart face take the 24
  // columns between them.
  //
  // Every end of a wing is blunt. A tip that narrows to a single pixel reads as a
  // horn, not a feather, so the top starts three pixels wide and the sweep runs
  // diagonally down to the headphone. The one pink line inside splits it into two
  // feather groups; widening that into a notch breaks the wing into two blobs.
  var GRID = [
    '......' + '.....PP..........PP.....' + '......',
    '......' + '....PWWP........PWWP....' + '......',
    '......' + '...PWWWWP......PWWWWP...' + '......',
    '......' + '..PWWWWWWWP..PWWWWWWWP..' + '......',
    '..PPP.' + '..PWWWWWWWWWWWWWWWWWWP..' + '.PPP..',
    '.PWWWP' + '.PWWWWWWWWWWWWWWWWWWWWP.' + 'PWWWP.',
    'PWWWWW' + '.PWWWWWWWWWWWWWWWWWWWWP.' + 'WWWWWP',
    'PWWWWW' + '.PWWPPPPPPPPPPPPPPPPWWP.' + 'WWWWWP',
    'PWWWWW' + 'GPWPHHHHHHHHHHHHHHHHPWPG' + 'WWWWWP',
    '.PWPWW' + 'GGPHHHHHHHHHHHHHHHHHHPGG' + 'WWPWP.',
    '.PPWWW' + 'GDPHHHHHHHHHHHHHHHHHHPDG' + 'WWWPP.',
    '..PWWW' + 'GDPHHHPHHPHHHHPHHPHHHPDG' + 'WWWP..',
    '...PPP' + 'GDPHHHHPPHHHHHHPPHHHHPDG' + 'PPP...',
    '......' + 'GDPHHHHHHHHHHHHHHHHHHPDG' + '......',
    '......' + 'GGPHHHHHHPHPPHPHHHHHHPGG' + '......',
    '......' + 'GPPHHHHHHHPHHPHHHHHHHPPG' + '......',
    '......' + '..PHHHHHHHHHHHHHHHHHHP..' + '......',
    '......' + '...PHHHHHHHHHHHHHHHHP...' + '......',
    '......' + '.....PHHHHHHHHHHHHP.....' + '......',
    '......' + '.......PHHHHHHHHP.......' + '......',
    '......' + '.........PHHHHP.........' + '......',
    '......' + '...........PP...........' + '......'
  ];

  var W = GRID[0].length, H = GRID.length;

  function palette(overrides) {
    if (!overrides) return DEFAULTS;
    var out = {};
    for (var k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) out[k] = DEFAULTS[k];
    for (var o in overrides) if (overrides.hasOwnProperty(o)) out[o] = overrides[o];
    return out;
  }

  // opts: { colors, scale }. Scale only changes the coordinate numbers written into
  // the markup; the SVG scales to whatever CSS gives it either way.
  function svgMarkup(opts) {
    opts = opts || {};
    var px = opts.scale || 1;
    var colors = palette(opts.colors);
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
              (W * px) + ' ' + (H * px) + '" shape-rendering="crispEdges">';
    for (var y = 0; y < H; y++) {
      var row = GRID[y];
      var x = 0;
      while (x < W) {
        var ch = row.charAt(x);
        if (ch === '.') { x++; continue; }
        // merge horizontal runs of one colour into a single rect
        var run = 1;
        while (x + run < W && row.charAt(x + run) === ch) run++;
        out += '<rect x="' + (x * px) + '" y="' + (y * px) +
               '" width="' + (run * px) + '" height="' + px +
               '" fill="' + colors[ch] + '"/>';
        x += run;
      }
    }
    return out + '</svg>';
  }

  function dataUri(opts) {
    return 'data:image/svg+xml,' + encodeURIComponent(svgMarkup(opts));
  }

  function setFavicon(href) {
    var link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = href.indexOf('image/svg') > -1 ? 'image/svg+xml' : 'image/png';
    link.href = href;
  }

  // opts: { colors, favicon }. favicon defaults to true — pass false to place the
  // logo without touching the tab icon.
  function mount(host, opts) {
    if (!host) return;
    opts = opts || {};
    host.innerHTML = svgMarkup(opts);
    if (opts.favicon !== false) setFavicon(dataUri(opts));
  }

  var api = {
    svgMarkup: svgMarkup,
    dataUri: dataUri,
    setFavicon: setFavicon,
    mount: mount,
    colors: DEFAULTS,
    size: { width: W, height: H }       // in cells, not pixels
  };

  // Handed out fresh on every read. Exposing one shared array instead would let a
  // caller that edits it break the grid for every other caller — a single slice at
  // startup protects the renderer's own copy but not the one handed out.
  Object.defineProperty(api, 'grid', {
    enumerable: true,
    get: function () { return GRID.slice(); }
  });

  root.HeartbeatIcon = api;
  if (root.RG) root.RG.icon = api;      // this game's namespace, when present
})(typeof window !== 'undefined' ? window : this);
