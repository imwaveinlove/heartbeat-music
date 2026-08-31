/* render.js — canvas sizing and all drawing.
 *
 * Reads gameplay state (RG.game.current, RG.fx) and never writes to it, apart
 * from expiring its own finished visual effects.
 */
(function () {
  'use strict';

  var C = RG.config;
  var cv = RG.el.cv, ctx = RG.el.ctx;

  // Everything below the hit line is thumb territory. On a tall phone that can be
  // generous; in landscape the whole stage may only be ~250px high, so the pads are
  // sized as a share of the viewport and clamped to stay both tappable and compact.
  var W = 0, H = 0, dpr = 1, padH = 82;

  function resize() {
    var wrap = cv.parentElement;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = wrap.clientWidth; H = wrap.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    padH = Math.max(46, Math.min(H * 0.19, 92));
  }

  function hitLineY() { return H - padH - 12; }
  function laneW() { return W / C.LANES; }
  // Shrinks note and text sizes on short screens so landscape does not feel cramped.
  function uiScale() { return Math.max(0.72, Math.min(H / 620, 1)); }
  function clear() { ctx.clearRect(0, 0, W, H); }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // A hold's tail: a rounded bar running from the note head up to its release
  // point. While the note is actually being held the bar is anchored at the hit
  // line instead, so it visibly drains away as the tail is carried.
  function drawTail(lane, yTop, yBottom, active) {
    if (yBottom < 0 || yTop > H) return;
    yTop = Math.max(yTop, -24);
    yBottom = Math.min(yBottom, H);
    var lw = laneW();
    var w = lw * 0.44;
    var x = lane * lw + (lw - w) / 2;
    var h = Math.max(4, yBottom - yTop);

    ctx.globalAlpha = active ? 0.95 : 0.55;
    ctx.fillStyle = C.LANE_COLORS[lane];
    roundRect(x, yTop, w, h, w / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function draw(t) {
    var game = RG.game.current;
    if (!game) return;

    var fx = RG.fx;
    var lw = laneW(), hy = hitLineY(), now = performance.now();
    var app = RG.game.approachTime();
    var pps = hy / app;          // pixels per second of note travel
    var us = uiScale();

    clear();

    // lane backgrounds + tap flash
    for (var i = 0; i < C.LANES; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.20)';
      ctx.fillRect(i * lw, 0, lw, H);
      var flash = now - fx.laneFlash[i];
      if (flash < 130) {
        ctx.globalAlpha = (1 - flash / 130) * 0.26;
        ctx.fillStyle = C.LANE_COLORS[i];
        ctx.fillRect(i * lw, 0, lw, H);
        ctx.globalAlpha = 1;
      }
    }

    ctx.strokeStyle = 'rgba(255,46,136,0.16)';
    ctx.lineWidth = 1;
    for (var d = 1; d < C.LANES; d++) {
      ctx.beginPath(); ctx.moveTo(d * lw, 0); ctx.lineTo(d * lw, H); ctx.stroke();
    }

    // hit line
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();
    ctx.strokeStyle = '#ff2e88';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();

    // hold tails first, so the note heads sit on top of them
    var notes = game.notes;
    for (var q = game.missPointer; q < notes.length; q++) {
      var ht = notes[q];
      if (ht.time - t > app + 0.2) break;
      if (!ht.hold || ht.judged) continue;
      drawTail(ht.lane, hy - (ht.holdEnd - t) * pps, hy - (ht.time - t) * pps, false);
    }
    // Tails being held are drawn from game.activeHolds, not the note list: the miss
    // sweep has already advanced missPointer past their heads by this point.
    for (var a = 0; a < C.LANES; a++) {
      var ah = game.activeHolds && game.activeHolds[a];
      if (ah) drawTail(a, hy - (ah.holdEnd - t) * pps, hy, true);
    }

    // notes
    var nh = Math.max(11, Math.min(lw * 0.22, 26) * us);
    for (var k = game.missPointer; k < notes.length; k++) {
      var nt = notes[k];
      var dt = nt.time - t;
      if (dt > app + 0.2) break;
      if (nt.judged) continue;
      var y = hy - dt * pps;
      if (y < -nh) continue;
      ctx.fillStyle = C.LANE_COLORS[nt.lane];
      ctx.shadowColor = C.LANE_COLORS[nt.lane];
      ctx.shadowBlur = 12;
      roundRect(nt.lane * lw + lw * 0.12, y - nh / 2, lw * 0.76, nh, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      // white rim keeps the candy colours legible against the pale field
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // hit bursts
    for (var f = fx.hits.length - 1; f >= 0; f--) {
      var burst = fx.hits[f], age = now - burst.at;
      if (age > 260) { fx.hits.splice(f, 1); continue; }
      var p = age / 260;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(burst.lane * lw + lw / 2, hy, 12 + p * 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // key pads
    for (var p2 = 0; p2 < C.LANES; p2++) {
      var px = p2 * lw, py = H - padH;
      var held = fx.keyHeld[p2] || (now - fx.laneFlash[p2] < 110);
      ctx.fillStyle = held ? C.LANE_COLORS[p2] : 'rgba(255,255,255,0.78)';
      ctx.fillRect(px + 3, py, lw - 6, padH - 6);
      ctx.strokeStyle = C.LANE_COLORS[p2];
      ctx.globalAlpha = held ? 1 : 0.55;
      ctx.lineWidth = 3;
      ctx.strokeRect(px + 3, py, lw - 6, padH - 6);
      ctx.globalAlpha = 1;
      ctx.fillStyle = held ? '#fff' : C.LANE_COLORS[p2];
      ctx.font = '700 ' + Math.round(17 * us) + 'px -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(C.KEY_LABELS[p2], px + lw / 2, py + (padH - 6) / 2);
    }

    // combo
    if (game.combo > 1) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.round(38 * us) + 'px -apple-system, Segoe UI, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(game.combo, W / 2, H * 0.30);
      ctx.fillStyle = '#ff2e88';
      ctx.fillText(game.combo, W / 2, H * 0.30);
      ctx.fillStyle = 'rgba(122,46,92,0.5)';
      ctx.font = '700 ' + Math.round(11 * us) + 'px -apple-system, Segoe UI, sans-serif';
      ctx.fillText('COMBO', W / 2, H * 0.30 + 26 * us);
    }

    // judgement flash
    if (fx.judge) {
      var jAge = now - fx.judge.at;
      if (jAge < 420) {
        ctx.globalAlpha = 1 - jAge / 420;
        ctx.font = '800 ' + Math.round(22 * us) + 'px -apple-system, Segoe UI, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeText(fx.judge.label, W / 2, H * 0.44);
        ctx.fillStyle = fx.judge.color;
        ctx.fillText(fx.judge.label, W / 2, H * 0.44);
        ctx.globalAlpha = 1;
      } else fx.judge = null;
    }

    // lead-in countdown
    if (t < 0) {
      ctx.font = '800 ' + Math.round(54 * us) + 'px -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(String(Math.ceil(-t)), W / 2, H * 0.42);
      ctx.fillStyle = '#ff2e88';
      ctx.fillText(String(Math.ceil(-t)), W / 2, H * 0.42);
    }
  }

  // Orientation changes settle a frame or two after the event fires, so re-measure late.
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  RG.render = {
    resize: resize, draw: draw, clear: clear,
    hitLineY: hitLineY, laneW: laneW, uiScale: uiScale
  };
})();
