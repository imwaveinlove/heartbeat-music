/* render.js — the corridor, and everything drawn inside it.
 *
 * v1 was a flat 2D lane chart. Here the playfield is a box in 3D that the notes
 * fly down: they are born at the far end, grow as they approach, and are played
 * when they reach the near end — the hit plane, which is where the grid of eight
 * touch targets is painted.
 *
 * The projection is derived from the viewport at resize, not hard-coded, so the
 * hit plane always lands in the same place on screen whatever the aspect ratio:
 *
 *   unit  — screen pixels per world unit AT THE HIT PLANE (also one cell wide)
 *   focal — unit * zNear, so that focal/zNear == unit falls out
 *   camH  — camera height above the grid centre, in world units
 *
 * Reads gameplay state and never writes to it, apart from expiring its own
 * finished visual effects.
 */
(function () {
  'use strict';

  var C = RG.config, V = RG.config.VIEW;
  var cv = RG.el.cv, ctx = RG.el.ctx;

  var W = 0, H = 0, dpr = 1;
  var unit = 60, focal = 60, horizonY = 60, hitCY = 400, camH = 5, rowSpread = 1;

  function resize() {
    var wrap = cv.parentElement;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = wrap.clientWidth; H = wrap.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Four cells across and two rows down both have to fit, so the cell size is
    // whichever of the two constraints bites first. Without the height term a
    // landscape phone puts the bottom row off the bottom of the stage.
    unit = Math.max(28, Math.min(W * 0.20, H * 0.20));
    focal = unit * V.zNear;
    // A cell is one world unit wide, but not necessarily one tall. On a tall
    // phone the width is what limits the cell size, and square cells then leave
    // most of the stage empty and the targets smaller than a thumb deserves —
    // so the rows are pushed apart until the grid uses its share of the height.
    // Capped: past about 1.45 the cells stop reading as cells.
    rowSpread = Math.max(1, Math.min(1.45, (H * 0.40) / (C.ROWS * unit)));
    // The corridor is given the top two thirds and the grid the rest, with a
    // band left clear below the hit frame for the judgement label — the one
    // place on screen a note never flies through.
    horizonY = H * 0.09;
    hitCY = H * 0.66;
    camH = (hitCY - horizonY) / unit;
  }

  // World (x right, y down, z away) to screen. s is the scale at that depth —
  // multiply any world length by it to get pixels.
  function proj(wx, wy, z) {
    var s = focal / z;
    return { x: W / 2 + wx * s, y: horizonY + (camH + wy) * s, s: s };
  }

  // Progress 0 (just spawned, far) to 1 (at the hit plane) for a note dt seconds
  // away, and the depth that maps to.
  function depthFor(dt, approach) {
    var p = 1 - dt / approach;
    return V.zFar + (V.zNear - V.zFar) * p;
  }

  function colX(col) { return (col - (C.COLS - 1) / 2); }   // -1.5 .. 1.5
  function rowY(row) { return (row === 0 ? 0.5 : -0.5) * rowSpread; }   // row 0 is lower
  function halfH() { return (C.ROWS / 2) * rowSpread; }

  // Where a cell's touch target sits on screen. game.js judges against this and
  // nothing else: the flight is animation, the target never moves.
  function cellCenter(col, row) {
    return proj(colX(col), rowY(row), V.zNear);
  }
  function cellUnit() { return unit; }

  function clear() { ctx.clearRect(0, 0, W, H); }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // The mascot's heart, as a path. r is the half-width.
  function heartPath(cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.92);
    ctx.bezierCurveTo(cx - r * 1.45, cy + r * 0.05, cx - r * 0.82, cy - r * 1.12, cx, cy - r * 0.32);
    ctx.bezierCurveTo(cx + r * 0.82, cy - r * 1.12, cx + r * 1.45, cy + r * 0.05, cx, cy + r * 0.92);
    ctx.closePath();
  }

  function fillArrow(cx, cy, r, dir, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(C.DIRS[dir].ang);      // the path below points up before rotation
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.70);
    ctx.lineTo(r * 0.58, r * 0.02);
    ctx.lineTo(r * 0.24, r * 0.02);
    ctx.lineTo(r * 0.24, r * 0.68);
    ctx.lineTo(-r * 0.24, r * 0.68);
    ctx.lineTo(-r * 0.24, r * 0.02);
    ctx.lineTo(-r * 0.58, r * 0.02);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // ---------- the corridor ----------
  // A rectangle in world space, drawn at one depth. Used for the hit frame, the
  // far mouth, and the rings that stream toward the player.
  function boxAt(z, alpha, width, color) {
    var hx = V.gridHalf, hy = halfH();
    var tl = proj(-hx, -hy, z), br = proj(hx, hy, z);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.globalAlpha = 1;
  }

  function line3(x1, y1, z1, x2, y2, z2, alpha, width, color) {
    var a = proj(x1, y1, z1), b = proj(x2, y2, z2);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawCorridor(t) {
    var hx = V.gridHalf, hy = halfH();

    // Light at the far end. Depth reads almost entirely from this: without a
    // bright vanishing point the converging lines look like a flat trapezoid.
    // Kept tight — spread across the whole top it stops being a light source and
    // just washes the notes out while they are still small.
    var vp = proj(0, 0, V.zFar);
    var glow = ctx.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, Math.max(W, H) * 0.26);
    glow.addColorStop(0, 'rgba(255,255,255,0.92)');
    glow.addColorStop(0.4, 'rgba(255,240,249,0.4)');
    glow.addColorStop(1, 'rgba(255,209,232,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Rings streaming toward the player. They carry the sense of speed that the
    // notes alone cannot: between two sparse notes the corridor would sit still.
    var RINGS = 7;
    for (var i = 0; i < RINGS; i++) {
      var p = ((t * 0.42) + i / RINGS) % 1;
      if (p < 0) p += 1;
      var z = V.zFar + (V.zNear - V.zFar) * p;
      boxAt(z, 0.10 + p * 0.16, 1 + p * 1.4, '#ff2e88');
    }

    // Edges of the box, plus the column and row dividers running its length.
    for (var c = 0; c <= C.COLS; c++) {
      var x = -hx + c;
      var edge = (c === 0 || c === C.COLS);
      line3(x, -hy, V.zFar, x, -hy, V.zNear, edge ? 0.5 : 0.22, edge ? 2 : 1, '#ff2e88');
      line3(x,  hy, V.zFar, x,  hy, V.zNear, edge ? 0.5 : 0.22, edge ? 2 : 1, '#ff2e88');
    }
    if (C.ROWS > 1) {
      line3(-hx, 0, V.zFar, -hx, 0, V.zNear, 0.20, 1, '#b57bee');
      line3( hx, 0, V.zFar,  hx, 0, V.zNear, 0.20, 1, '#b57bee');
    }
    line3(-hx, -hy, V.zFar, -hx, -hy, V.zNear, 0.45, 2, '#b57bee');
    line3( hx, -hy, V.zFar,  hx, -hy, V.zNear, 0.45, 2, '#b57bee');

    boxAt(V.zFar, 0.5, 1.5, '#ff9cc9');
  }

  // The near wall: an opaque panel, the combo faint behind the glass, then the
  // eight targets on top.
  //
  // The panel is not decoration. Every line of the corridor converges on the hit
  // frame, and the floor lines in particular run all the way down across the
  // target area — seen through translucent cells they read as cracks. Stopping
  // the corridor at an opaque wall is what makes the targets legible.
  function drawStage(rows, now, fx, game) {
    var hx = V.gridHalf, hy = halfH();
    var tl = proj(-hx, -hy, V.zNear), br = proj(hx, hy, V.zNear);
    var pw = br.x - tl.x, ph = br.y - tl.y;

    ctx.fillStyle = 'rgba(255,240,248,0.94)';
    roundRect(tl.x - 5, tl.y - 5, pw + 10, ph + 10, unit * 0.12);
    ctx.fill();

    // Behind the glass rather than over the corridor: at the top of the screen it
    // sat exactly where the notes are born and covered them.
    if (game.combo > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tl.x - 5, tl.y - 5, pw + 10, ph + 10);
      ctx.clip();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.round(unit * 1.15) + 'px -apple-system, Segoe UI, sans-serif';
      ctx.fillStyle = 'rgba(255,46,136,0.16)';
      ctx.fillText(game.combo, W / 2, hitCY);
      ctx.restore();
    }

    var pad = unit * 0.06;
    var cw = unit - pad * 2, ch = unit * rowSpread - pad * 2;
    for (var col = 0; col < C.COLS; col++) {
      for (var row = 0; row < rows; row++) {
        var c = cellCenter(col, row);
        var x = c.x - cw / 2, y = c.y - ch / 2;
        var flash = now - ((fx.cellFlash[col] && fx.cellFlash[col][row]) || -9e9);
        var lit = flash < 150;

        ctx.fillStyle = lit ? C.COL_COLORS[col] : 'rgba(255,255,255,0.8)';
        ctx.globalAlpha = lit ? (1 - flash / 150) * 0.55 + 0.25 : 1;
        roundRect(x, y, cw, ch, Math.min(cw, ch) * 0.24);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.strokeStyle = C.COL_COLORS[col];
        ctx.globalAlpha = lit ? 1 : 0.6;
        ctx.lineWidth = lit ? 4 : 2.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // The hit plane itself, so it is obvious where "now" is in the corridor.
    boxAt(V.zNear, 0.9, 4, 'rgba(255,255,255,0.95)');
    boxAt(V.zNear, 0.85, 2, '#ff2e88');
  }

  // ---------- notes ----------
  // A tail is a ribbon receding into the corridor: sampled at a handful of depths
  // and stroked, rather than drawn as one quad, because perspective makes it
  // narrow toward the far end and a straight line would not.
  function drawTail(note, t, approach, active) {
    var wx = colX(note.col), wy = rowY(note.row);
    var headDt = active ? 0 : Math.max(0, note.time - t);
    var tailDt = Math.max(headDt, note.holdEnd - t);
    if (tailDt <= headDt + 0.001) return;

    var STEPS = 10;
    var left = [], right = [];
    for (var i = 0; i <= STEPS; i++) {
      var dt = headDt + (tailDt - headDt) * (i / STEPS);
      if (dt > approach) break;
      var z = depthFor(dt, approach);
      var p = proj(wx, wy, z);
      var hw = 0.19 * p.s;
      left.push([p.x - hw, p.y]);
      right.push([p.x + hw, p.y]);
    }
    if (left.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (var a = 1; a < left.length; a++) ctx.lineTo(left[a][0], left[a][1]);
    for (var b = right.length - 1; b >= 0; b--) ctx.lineTo(right[b][0], right[b][1]);
    ctx.closePath();

    ctx.globalAlpha = active ? 0.95 : 0.6;
    ctx.fillStyle = C.COL_COLORS[note.col];
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawNote(note, p, r, alpha) {
    var color = C.COL_COLORS[note.col];
    ctx.globalAlpha = alpha;

    if (note.type === C.BOMB) {
      // Deliberately not candy: a bomb has to read as "not for you" at a glance,
      // from the far end of the corridor, at a fifth of its final size.
      ctx.fillStyle = '#3b1230';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.86, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff2e88';
      ctx.lineWidth = Math.max(1.5, r * 0.13);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = Math.max(1.5, r * 0.17);
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.34, p.y - r * 0.34); ctx.lineTo(p.x + r * 0.34, p.y + r * 0.34);
      ctx.moveTo(p.x + r * 0.34, p.y - r * 0.34); ctx.lineTo(p.x - r * 0.34, p.y + r * 0.34);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    if (note.type === C.SLASH) {
      // A cube with an arrow, borrowed wholesale from the game this one is a nod
      // to. The shape difference is what tells a flick from a touch at distance —
      // the arrow inside is only readable in the last half second.
      ctx.shadowColor = color;
      ctx.shadowBlur = Math.min(18, r * 0.7);
      ctx.fillStyle = color;
      roundRect(p.x - r, p.y - r, r * 2, r * 2, r * 0.3);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = Math.max(1.2, r * 0.13);
      ctx.stroke();
      fillArrow(p.x, p.y, r, note.dir, 'rgba(255,255,255,0.96)');
      ctx.globalAlpha = 1;
      return;
    }

    // TAP and HOLD share a head. A hold is told apart by its ribbon, and by the
    // ring around it that says "stay here".
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.min(18, r * 0.7);
    ctx.fillStyle = color;
    heartPath(p.x, p.y, r * 0.98);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(1.2, r * 0.13);
    ctx.stroke();

    if (note.type === C.HOLD) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- frame ----------
  function draw(t) {
    var game = RG.game.current;
    if (!game) return;

    var fx = RG.fx;
    var now = performance.now();
    var approach = RG.game.approachTime();
    var rows = C.DIFFS[RG.settings.diff].rows;

    clear();
    ctx.save();
    // A bomb shoves the whole corridor. Cheap, and it is the one event that has to
    // be felt rather than read.
    if (fx.shake > 0.01) {
      ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
      fx.shake *= 0.86;
    }

    drawCorridor(Math.max(0, t));
    drawStage(rows, now, fx, game);

    // Tails behind heads, and everything far before everything near: with no depth
    // buffer the draw order is the depth order.
    var notes = game.notes;
    var visible = [];
    for (var i = game.missPointer; i < notes.length; i++) {
      var n = notes[i];
      var dt = n.time - t;
      if (dt > approach) break;
      if (n.judged) continue;
      if (dt < -C.WINDOWS.miss) continue;
      visible.push(n);
    }

    for (var h = 0; h < visible.length; h++) {
      if (visible[h].type === C.HOLD) drawTail(visible[h], t, approach, false);
    }
    for (var a = 0; a < C.COLS; a++) {
      var held = game.activeHolds && game.activeHolds[a];
      if (held) drawTail(held, t, approach, true);
    }

    for (var k = visible.length - 1; k >= 0; k--) {
      var nt = visible[k];
      var dt2 = Math.max(0, nt.time - t);
      var z = depthFor(dt2, approach);
      var p = proj(colX(nt.col), rowY(nt.row), z);
      var r = 0.36 * p.s;
      // Fade in over the first slice of the flight so notes do not pop into
      // existence at the mouth of the corridor.
      var fade = Math.min(1, (1 - dt2 / approach) / 0.10);
      drawNote(nt, p, r, Math.max(0, fade));
    }

    // ---------- effects ----------
    for (var f = fx.hits.length - 1; f >= 0; f--) {
      var burst = fx.hits[f], age = now - burst.at;
      if (age > 300) { fx.hits.splice(f, 1); continue; }
      var pr = age / 300;
      ctx.globalAlpha = 1 - pr;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, unit * (0.28 + pr * 0.75), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The streak a finger left behind. Drawn from the game's own record rather
    // than from the live pointer so it outlives the gesture by a few frames.
    for (var s = fx.slashes.length - 1; s >= 0; s--) {
      var sl = fx.slashes[s], sage = now - sl.at;
      if (sage > 190) { fx.slashes.splice(s, 1); continue; }
      ctx.globalAlpha = (1 - sage / 190) * 0.85;
      ctx.strokeStyle = sl.color;
      ctx.lineCap = 'round';
      ctx.lineWidth = 7 * (1 - sage / 190) + 2;
      ctx.beginPath();
      ctx.moveTo(sl.x0, sl.y0);
      ctx.lineTo(sl.x1, sl.y1);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 1;
    }

    var us = Math.max(0.72, Math.min(H / 620, 1));

    // Below the hit frame, not above it. Above, it sits squarely in the last
    // half second of every note's flight and covers the thing being judged.
    if (fx.judge) {
      var jAge = now - fx.judge.at;
      if (jAge < 420) {
        ctx.globalAlpha = 1 - jAge / 420;
        ctx.font = '800 ' + Math.round(22 * us) + 'px -apple-system, Segoe UI, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        var jy = Math.min(H - 16 * us, hitCY + unit * halfH() + 22 * us);
        ctx.strokeText(fx.judge.label, W / 2, jy);
        ctx.fillStyle = fx.judge.color;
        ctx.fillText(fx.judge.label, W / 2, jy);
        ctx.globalAlpha = 1;
      } else fx.judge = null;
    }

    if (t < 0) {
      ctx.font = '800 ' + Math.round(54 * us) + 'px -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(String(Math.ceil(-t)), W / 2, H * 0.30);
      ctx.fillStyle = '#ff2e88';
      ctx.fillText(String(Math.ceil(-t)), W / 2, H * 0.30);
    }

    ctx.restore();
  }

  // Orientation changes settle a frame or two after the event fires.
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  RG.render = {
    resize: resize, draw: draw, clear: clear,
    cellCenter: cellCenter, cellUnit: cellUnit,
    // Cells are not square once the rows are spread, so judgement needs both
    // sides — a width-only radius would clip the top and bottom of every target.
    cellSize: function () { return { w: unit, h: unit * rowSpread }; }
  };
})();
