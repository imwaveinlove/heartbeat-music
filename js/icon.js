/* icon.js — the heartbeat♡ mascot, drawn as pixel art from a character grid.
 *
 * Kept as a grid rather than a binary image so it scales to any size, stays
 * editable, and needs no file alongside index.html. Rendered to an SVG data URI
 * for the favicon and injected inline as the menu logo.
 */
(function () {
  'use strict';

  var COLORS = {
    P: '#ff2e88',   // hot pink outline
    W: '#ffffff',   // white head
    H: '#ffb3d9',   // light pink heart face
    G: '#c7cbd9',   // headphone cup
    D: '#9aa0b4'    // headphone shade
  };

  // 40 x 22. '.' is transparent.
  // Columns 0-7 and 32-39 are the wings; the cat head and heart face take the 24
  // columns between them.
  //
  // The wings are deliberately blunt. An earlier version came to a single-pixel
  // point at the top outer corner, which read as a horn rather than a feather —
  // soft cartoon wings have rounded ends. Each one is a long rounded sweep with a
  // single pink line inside; at this size that line reads as a feather split,
  // while a wider notch just breaks the wing into two disconnected blobs.
  var GRID = [
    '........' + '.....PP..........PP.....' + '........',
    '........' + '....PWWP........PWWP....' + '........',
    '........' + '...PWWWWP......PWWWWP...' + '........',
    '..PPP...' + '..PWWWWWWWP..PWWWWWWWP..' + '...PPP..',
    '.PWWWP..' + '..PWWWWWWWWWWWWWWWWWWP..' + '..PWWWP.',
    'PWWWWWP.' + '.PWWWWWWWWWWWWWWWWWWWWP.' + '.PWWWWWP',
    'PWWWWWWP' + '.PWWWWWWWWWWWWWWWWWWWWP.' + 'PWWWWWWP',
    'PWWWWWWW' + '.PWWPPPPPPPPPPPPPPPPWWP.' + 'WWWWWWWP',
    'PWWWWWWW' + 'GPWPHHHHHHHHHHHHHHHHPWPG' + 'WWWWWWWP',
    '.PWPWWWW' + 'GGPHHHHHHHHHHHHHHHHHHPGG' + 'WWWWPWP.',
    '.PPWWWWW' + 'GDPHHHHHHHHHHHHHHHHHHPDG' + 'WWWWWPP.',
    '..PWWWWW' + 'GDPHHHPHHPHHHHPHHPHHHPDG' + 'WWWWWP..',
    '...PWWWW' + 'GDPHHHHPPHHHHHHPPHHHHPDG' + 'WWWWP...',
    '....PPPP' + 'GDPHHHHHHHHHHHHHHHHHHPDG' + 'PPPP....',
    '........' + 'GGPHHHHHHPHPPHPHHHHHHPGG' + '........',
    '........' + 'GPPHHHHHHHPHHPHHHHHHHPPG' + '........',
    '........' + '..PHHHHHHHHHHHHHHHHHHP..' + '........',
    '........' + '...PHHHHHHHHHHHHHHHHP...' + '........',
    '........' + '.....PHHHHHHHHHHHHP.....' + '........',
    '........' + '.......PHHHHHHHHP.......' + '........',
    '........' + '.........PHHHHP.........' + '........',
    '........' + '...........PP...........' + '........'
  ];

  var W = GRID[0].length, H = GRID.length;

  function svgMarkup(scale) {
    var px = scale || 1;
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
               '" fill="' + COLORS[ch] + '"/>';
        x += run;
      }
    }
    return out + '</svg>';
  }

  function dataUri() {
    return 'data:image/svg+xml,' + encodeURIComponent(svgMarkup(1));
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

  function mount(host) {
    if (!host) return;
    host.innerHTML = svgMarkup(1);
    setFavicon(dataUri());
  }

  RG.icon = { svgMarkup: svgMarkup, dataUri: dataUri, mount: mount };
})();
