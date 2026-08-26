/* icon.js — the heartbeat♡ mascot, drawn as pixel art from a character grid.
 *
 * Kept as a grid rather than a binary image so it scales to any size, stays
 * editable, and needs no file alongside index.html. Rendered to an SVG data URI
 * for the favicon and injected inline as the menu logo.
 *
 * icon.png (the real mascot) is preferred when present; the pixel art is the
 * fallback so the page still has a logo and favicon if that file goes missing.
 */
(function () {
  'use strict';

  var IMAGE_PATH = 'icon.png';   // the real mascot; pixel art below is the fallback

  var COLORS = {
    P: '#ff2e88',   // hot pink outline
    W: '#ffffff',   // white head
    H: '#ffb3d9',   // light pink heart face
    G: '#c7cbd9',   // headphone cup
    D: '#9aa0b4'    // headphone shade
  };

  // 24 x 22. '.' is transparent.
  var GRID = [
    '.....PP..........PP.....',
    '....PWWP........PWWP....',
    '...PWWWWP......PWWWWP...',
    '..PWWWWWWWP..PWWWWWWWP..',
    '..PWWWWWWWWWWWWWWWWWWP..',
    '.PWWWWWWWWWWWWWWWWWWWWP.',
    '.PWWWWWWWWWWWWWWWWWWWWP.',
    '.PWWPPPPPPPPPPPPPPPPWWP.',
    'GPWPHHHHHHHHHHHHHHHHPWPG',
    'GGPHHHHHHHHHHHHHHHHHHPGG',
    'GDPHHHHHHHHHHHHHHHHHHPDG',
    'GDPHHHPHHPHHHHPHHPHHHPDG',
    'GDPHHHHPPHHHHHHPPHHHHPDG',
    'GDPHHHHHHHHHHHHHHHHHHPDG',
    'GGPHHHHHHPHPPHPHHHHHHPGG',
    'GPPHHHHHHHPHHPHHHHHHHPPG',
    '..PHHHHHHHHHHHHHHHHHHP..',
    '...PHHHHHHHHHHHHHHHHP...',
    '.....PHHHHHHHHHHHHP.....',
    '.......PHHHHHHHHP.......',
    '.........PHHHHP.........',
    '...........PP...........'
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

  // Swap in assets/icon.png if it is actually there; the pixel art stays otherwise.
  function useImage(onFound) {
    var probe = new Image();
    probe.onload = function () {
      if (!probe.naturalWidth) return;
      setFavicon(IMAGE_PATH);
      onFound(IMAGE_PATH);
    };
    probe.src = IMAGE_PATH;
  }

  function mount(host) {
    if (!host) return;
    host.innerHTML = svgMarkup(1);
    setFavicon(dataUri());
    useImage(function (path) {
      host.innerHTML = '<img src="' + path + '" alt="heartbeat">';
    });
  }

  RG.icon = { svgMarkup: svgMarkup, dataUri: dataUri, mount: mount };
})();
