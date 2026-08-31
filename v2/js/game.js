/* game.js — playback clock, judgement, the frame loop, and touch input.
 *
 * Timing is driven by the AudioContext clock rather than rAF timestamps, so
 * judgement stays locked to the audio even if frames drop.
 *
 * Judgement is time AND place. A note is live for a window either side of its
 * beat, and it is claimed by a touch that lands inside its cell — always the
 * cell's fixed target at the hit plane, never the note's animated position.
 * Chasing the flying sprite would make the target move under the finger and turn
 * every judgement into a guess about perspective.
 */
(function () {
  'use strict';

  var C = RG.config, el = RG.el, fx = RG.fx;

  var current = null;   // the active game, or null outside a song
  var rafId = null;
  var source = null;    // the playing AudioBufferSourceNode

  // ---------- clock ----------
  function songTime() {
    return RG.audio.ctx().currentTime - current.startAt + RG.settings.offset / 1000;
  }
  function approachTime() { return C.BASE_APPROACH / RG.settings.speed; }

  function playFrom(offsetSec) {
    var ctx = RG.audio.ctx();
    stopSource();
    source = ctx.createBufferSource();
    source.buffer = RG.song.buffer;
    source.connect(ctx.destination);
    var startDelay = offsetSec === 0 ? C.LEAD_IN : 0.05;
    source.start(ctx.currentTime + startDelay, offsetSec);
    current.startAt = ctx.currentTime + startDelay - offsetSec;
  }

  function stopSource() {
    if (source) {
      try { source.onended = null; source.stop(); } catch (e) {}
      source = null;
    }
  }

  // ---------- scoring ----------
  function updateHud() {
    el.vScore.textContent = current.score;
    el.vCombo.textContent = current.combo;
    var c = current.counts;
    var judged = c.perfect + c.great + c.good + c.miss;
    var acc = judged ? (current.weighted / (judged * C.SCORES.perfect)) * 100 : 100;
    el.vAcc.textContent = acc.toFixed(1) + '%';
    current.accuracy = acc;
  }

  function flashCell(col, row) { fx.cellFlash[col][row] = performance.now(); }

  function registerHit(kind, note) {
    var g = current;
    var at = RG.render.cellCenter(note.col, note.row);
    if (kind === 'miss') {
      g.counts.miss++;
      g.combo = 0;
      fx.judge = { label: 'MISS', color: '#b87fa6', at: performance.now() };
      RG.audio.tapMiss();
    } else {
      g.counts[kind]++;
      g.combo++;
      if (g.combo > g.maxCombo) g.maxCombo = g.combo;
      // The banner reads these; it owns where the pair is on screen, so it only
      // needs to be told that something happened and when.
      fx.comboPop = performance.now();
      if (g.combo >= 10 && g.combo % 10 === 0) fx.comboMilestone = fx.comboPop;
      var mult = 1 + Math.min(g.combo, 100) * 0.005;
      g.score += Math.round(C.SCORES[kind] * mult);
      g.weighted += C.SCORES[kind];
      var col = kind === 'perfect' ? '#ff2e88' : kind === 'great' ? '#2fc9b8' : '#5f9cff';
      fx.judge = { label: kind.toUpperCase(), color: col, at: performance.now() };
      fx.hits.push({ x: at.x, y: at.y, at: performance.now(), color: col });
      if (note.type === C.SLASH) RG.audio.slash(kind, note.col);
      else RG.audio.tap(kind, note.col);
    }
    updateHud();
  }

  function judgeNote(note, t) {
    var d = Math.abs(note.time - t);
    note.judged = true;
    note.hit = true;
    registerHit(d <= C.WINDOWS.perfect ? 'perfect'
              : d <= C.WINDOWS.great   ? 'great' : 'good', note);
    flashCell(note.col, note.row);
  }

  function hitBomb(note) {
    note.judged = true;
    current.counts.bomb++;
    current.combo = 0;
    current.score = Math.max(0, current.score - C.BOMB_PENALTY);
    fx.judge = { label: 'BOMB!', color: '#3b1230', at: performance.now() };
    fx.shake = 14;
    RG.audio.bomb();
    updateHud();
  }

  // ---------- geometry ----------
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

  // Distance from a point to the segment a finger covered since the last move.
  // A fast flick can jump most of a cell between two pointermove events, so
  // testing only the endpoint would let notes slip through the gesture.
  function distToSegment(px, py, x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return dist(px, py, x0, y0);
    var u = ((px - x0) * dx + (py - y0) * dy) / len2;
    u = Math.max(0, Math.min(1, u));
    return dist(px, py, x0 + u * dx, y0 + u * dy);
  }

  // Distance from a cell centre to the segment a finger just covered, measured in
  // cell-widths. Cells are taller than they are wide on a tall screen, so the y
  // axis is squashed first: judged as a plain circle, a target would be dead in
  // its own top and bottom corners.
  function cellDist(cx, cy, x0, y0, x1, y1) {
    var k = RG.render.cellSize();
    var q = k.w / k.h;
    return distToSegment(cx, cy * q, x0, y0 * q, x1, y1 * q);
  }

  // Which cell a screen point is in, or -1. Used to tell "the finger moved into
  // a new cell" from "the finger is parked" — parking must never farm notes.
  // Packed as one integer so "did the cell change" is a plain comparison.
  function cellAt(x, y) {
    var k = RG.render.cellSize();
    for (var col = 0; col < C.COLS; col++) {
      for (var row = 0; row < C.ROWS; row++) {
        var c = RG.render.cellCenter(col, row);
        if (Math.abs(x - c.x) <= k.w / 2 && Math.abs(y - c.y) <= k.h / 2) {
          return col * C.ROWS + row;
        }
      }
    }
    return -1;
  }
  function cellCol(i) { return Math.floor(i / C.ROWS); }
  function cellRow(i) { return i % C.ROWS; }

  // The best live note reachable from a point (or from the segment just covered).
  // Closest in time wins; distance only breaks ties, so a touch between two cells
  // still claims the note that is actually due.
  function findNote(t, wants, x0, y0, x1, y1) {
    if (!current) return null;
    var R = C.TOUCH_RADIUS * RG.render.cellUnit();
    var notes = current.notes;
    var best = null, bestScore = Infinity;
    for (var i = current.missPointer; i < notes.length; i++) {
      var n = notes[i];
      if (n.time > t + C.WINDOWS.good) break;
      if (n.judged || !wants(n)) continue;
      var dt = Math.abs(n.time - t);
      if (dt > C.WINDOWS.good) continue;
      var c = RG.render.cellCenter(n.col, n.row);
      var d = cellDist(c.x, c.y, x0, y0, x1, y1);
      if (d > R) continue;
      var score = dt + (d / R) * 0.02;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  // Bombs use a tighter radius than notes: brushing past one should not cost the
  // combo, only running into it should.
  function bombAt(t, x0, y0, x1, y1) {
    if (!current) return null;
    var R = 0.55 * RG.render.cellUnit();
    var notes = current.notes;
    for (var i = current.missPointer; i < notes.length; i++) {
      var n = notes[i];
      if (n.time > t + 0.14) break;
      if (n.judged || n.type !== C.BOMB) continue;
      if (Math.abs(n.time - t) > 0.14) continue;
      var c = RG.render.cellCenter(n.col, n.row);
      if (cellDist(c.x, c.y, x0, y0, x1, y1) <= R) return n;
    }
    return null;
  }

  // ---------- holds ----------
  function startHold(note, pointer) {
    current.activeHolds[note.col] = note;
    pointer.holdCol = note.col;
    pointer.holdRow = note.row;
  }

  function releaseHold(col, graceful) {
    var note = current && current.activeHolds[col];
    if (!note) return;
    current.activeHolds[col] = null;
    if (!graceful) return;

    if (songTime() >= note.holdEnd - C.HOLD.RELEASE_GRACE) {
      completeHold(note);
    } else {
      note.holdBroken = true;
      current.counts.miss++;
      current.combo = 0;
      fx.judge = { label: 'BROKEN', color: '#b87fa6', at: performance.now() };
      RG.audio.tapMiss();
      updateHud();
    }
  }

  function completeHold(note) {
    note.holdDone = true;
    current.score += C.HOLD.BONUS;
    var c = RG.render.cellCenter(note.col, note.row);
    fx.hits.push({ x: c.x, y: c.y, at: performance.now(), color: C.COL_COLORS[note.col] });
    flashCell(note.col, note.row);
    RG.audio.holdComplete(note.col);
    updateHud();
  }

  // ---------- input ----------
  // One entry per finger, so two thumbs judge independently and a slash with one
  // hand cannot be broken by the other hand touching down.
  var pointers = {};

  function livePlay() { return current && !current.paused && !current.ended; }

  function canvasPoint(e) {
    var rect = el.cv.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // The slash: walk the trail backwards from where the finger is now and take the
  // MOST RECENT sample it has travelled far enough from. That sample is where
  // this flick began — its position gives the direction, its timestamp gives the
  // moment to judge.
  //
  // Both of those were wrong before, and measurably so:
  //
  //  - Distance measured inside a fixed 130ms window meant a deliberate flick at
  //    55ms per sample never accumulated the threshold and could not be hit at
  //    all, however well it was aimed. Speed is not what separates a flick from a
  //    finger wandering across the glass.
  //  - Judging at the moment the threshold tripped read late by however long the
  //    finger took — 51ms for a fast flick, 219ms for a slow one, which turned a
  //    perfectly timed slow flick into a MISS.
  //
  // Net displacement handles the wandering case on its own: a finger that goes
  // back and forth never gets far from any recent sample. And because the search
  // is backwards, a finger that rested in the cell before flicking anchors to the
  // start of the flick, not to where it had been waiting.
  function slashVector(p, now) {
    var trail = p.trail;
    var need = C.SWIPE.minDist * RG.render.cellUnit();
    for (var i = trail.length - 1; i >= 0; i--) {
      var s = trail[i];
      if (now - s.t > C.SWIPE.maxAge * 1000) break;
      var dx = p.x - s.x, dy = p.y - s.y;
      var len = Math.hypot(dx, dy);
      if (len >= need) return { dx: dx / len, dy: dy / len, len: len, at: s.t };
    }
    return null;
  }

  function directionMatches(vec, dir) {
    var d = C.DIRS[dir];
    var dot = vec.dx * d.dx + vec.dy * d.dy;
    return dot >= Math.cos((C.SWIPE.angleTol * Math.PI) / 180);
  }

  function onDown(e) {
    if (!livePlay()) return;
    e.preventDefault();
    var pt = canvasPoint(e);
    var now = performance.now();
    var p = { x: pt.x, y: pt.y, trail: [{ x: pt.x, y: pt.y, t: now }],
              cell: cellAt(pt.x, pt.y), holdCol: -1, holdRow: -1 };
    pointers[e.pointerId] = p;
    if (p.cell >= 0) flashCell(cellCol(p.cell), cellRow(p.cell));

    var t = songTime();
    var bomb = bombAt(t, pt.x, pt.y, pt.x, pt.y);
    if (bomb) { hitBomb(bomb); return; }

    // A slash is not resolved on touchdown — it needs the travel that follows.
    // A hold is: it is the one note the player answers by staying put.
    var note = findNote(t, function (n) { return n.type === C.HOLD; },
                        pt.x, pt.y, pt.x, pt.y);
    if (!note) return;

    judgeNote(note, t);
    startHold(note, p);
  }

  function onMove(e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    if (!livePlay()) return;
    e.preventDefault();

    var pt = canvasPoint(e);
    var now = performance.now();
    var x0 = p.x, y0 = p.y;
    p.x = pt.x; p.y = pt.y;
    p.trail.push({ x: pt.x, y: pt.y, t: now });
    while (p.trail.length > 1 && now - p.trail[0].t > 1200) p.trail.shift();

    var t = songTime();

    var bomb = bombAt(t, x0, y0, pt.x, pt.y);
    if (bomb) hitBomb(bomb);

    // A slash cuts everything it passes through, exactly as one swing does in the
    // game this borrows from — that is the whole appeal of a directional note.
    var vec = slashVector(p, now);
    if (vec) {
      // The whole gesture is credited to the moment it began, for finding the
      // note as well as for scoring it. Searching at wall-clock time and then
      // scoring at the corrected one would let a flick score PERFECT only if it
      // was still inside the window when it finished — which is the bug.
      var st = t - (now - vec.at) / 1000;
      for (var guard = 0; guard < 4; guard++) {
        var slash = findNote(st, function (n) {
          return n.type === C.SLASH && directionMatches(vec, n.dir);
        }, x0, y0, pt.x, pt.y);
        if (!slash) break;
        judgeNote(slash, st);
      }
      fx.slashes.push({ x0: x0, y0: y0, x1: pt.x, y1: pt.y,
                        at: now, color: 'rgba(255,255,255,0.9)' });
    }

    // Sliding into a cell where a hold is due starts it, so a hold that follows a
    // flick does not need the finger lifted and put back down.
    var cell = cellAt(pt.x, pt.y);
    if (cell >= 0 && cell !== p.cell) {
      flashCell(cellCol(cell), cellRow(cell));
      if (p.holdCol < 0) {
        var held = findNote(t, function (n) {
          return n.type === C.HOLD &&
                 n.col === cellCol(cell) && n.row === cellRow(cell);
        }, x0, y0, pt.x, pt.y);
        if (held) { judgeNote(held, t); startHold(held, p); }
      }
    }
    p.cell = cell;

    // A finger that wanders out of the cell it is holding has let go of the tail.
    if (p.holdCol >= 0) {
      var c = RG.render.cellCenter(p.holdCol, p.holdRow);
      if (cellDist(c.x, c.y, pt.x, pt.y, pt.x, pt.y) > RG.render.cellUnit() * 1.05) {
        releaseHold(p.holdCol, true);
        p.holdCol = -1;
      }
    }
  }

  function onUp(e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    delete pointers[e.pointerId];
    if (p.holdCol >= 0 && current && !current.ended) releaseHold(p.holdCol, true);
  }

  el.cv.addEventListener('pointerdown', onDown);
  // move/up on window: a finger that slides off the canvas must not stick a tail
  // down, and a flick that leaves the stage should still have counted.
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Escape') togglePause();
  });

  // ---------- loop ----------
  function loop() {
    if (!current || current.ended) return;
    if (current.paused) { rafId = requestAnimationFrame(loop); return; }

    var t = songTime();
    var notes = current.notes;

    // Retired a gesture's length after the miss window, not at it. A flick that
    // began on the beat can take a couple of hundred milliseconds to declare
    // itself, and sweeping the note away at the window means the note is already
    // scored MISS by the time the flick it earned arrives.
    while (current.missPointer < notes.length &&
           notes[current.missPointer].time < t - C.WINDOWS.miss - C.SWIPE.maxAge) {
      var n = notes[current.missPointer];
      if (!n.judged) {
        // A bomb that flew past untouched is the good outcome, not a miss.
        if (n.type === C.BOMB) n.judged = true;
        else { n.judged = true; registerHit('miss', n); }
      }
      current.missPointer++;
    }

    for (var h = 0; h < C.COLS; h++) {
      var held = current.activeHolds[h];
      if (held && t >= held.holdEnd) {
        current.activeHolds[h] = null;
        completeHold(held);
        for (var id in pointers) if (pointers[id].holdCol === h) pointers[id].holdCol = -1;
      }
    }

    RG.render.draw(t);
    el.progressFill.style.width =
      Math.max(0, Math.min(t / RG.song.buffer.duration, 1)) * 100 + '%';

    if (t > RG.song.buffer.duration + 0.6) { end(); return; }
    rafId = requestAnimationFrame(loop);
  }

  // ---------- lifecycle ----------
  function start() {
    if (!RG.song.chart || !RG.song.chart.length) return;

    current = {
      // A fresh copy per run, so replaying never inherits the last run's
      // judgements. hold/holdEnd must come along or every tail silently becomes
      // a plain tap.
      notes: RG.song.chart.map(function (n) {
        return {
          time: n.time, col: n.col, row: n.row, type: n.type, dir: n.dir,
          hold: n.hold || 0, holdEnd: n.holdEnd || 0,
          hit: false, judged: false, holdDone: false, holdBroken: false
        };
      }),
      total: RG.song.chart.length,
      score: 0, combo: 0, maxCombo: 0,
      counts: { perfect: 0, great: 0, good: 0, miss: 0, bomb: 0 },
      weighted: 0, missPointer: 0,
      activeHolds: [null, null, null, null],
      paused: false, ended: false,
      startAt: 0, pausedAt: 0
    };
    RG.game.current = current;

    fx.hits = []; fx.slashes = []; fx.judge = null; fx.shake = 0;
    fx.comboPop = 0; fx.comboMilestone = 0;
    fx.cellFlash = [];
    for (var cf = 0; cf < C.COLS; cf++) {
      fx.cellFlash.push(new Array(C.ROWS).fill(0));
    }
    pointers = {};

    el.menuOverlay.classList.add('hidden');
    el.resultOverlay.classList.add('hidden');
    el.pauseOverlay.classList.add('hidden');
    el.pauseBtn.classList.remove('hidden');

    RG.render.resize();
    updateHud();
    playFrom(0);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  // Drop tails in progress without penalty — a pause or a quit is not a miss.
  function clearHolds() {
    if (current) current.activeHolds = [null, null, null, null];
    pointers = {};
  }

  function pause() {
    if (!current || current.paused || current.ended) return;
    current.paused = true;
    current.pausedAt = songTime();
    stopSource();
    clearHolds();
    el.pauseOverlay.classList.remove('hidden');
  }

  function resume() {
    if (!current || !current.paused) return;
    el.pauseOverlay.classList.add('hidden');
    current.paused = false;
    var from = Math.max(0, current.pausedAt);
    playFrom(from);
    while (current.missPointer > 0 &&
           current.notes[current.missPointer - 1].time > from - C.WINDOWS.miss) {
      current.missPointer--;
    }
  }

  function togglePause() {
    if (!current || current.ended) return;
    if (current.paused) resume(); else pause();
  }

  function end() {
    current.ended = true;
    stopSource();
    clearHolds();
    if (rafId) cancelAnimationFrame(rafId);
    el.pauseBtn.classList.add('hidden');

    var c = current.counts;
    var judged = c.perfect + c.great + c.good + c.miss;
    var acc = judged ? (current.weighted / (judged * C.SCORES.perfect)) * 100 : 0;
    var grade = acc >= 95 ? 'S' : acc >= 88 ? 'A' : acc >= 78 ? 'B' : acc >= 65 ? 'C' : 'D';

    el.grade.textContent = grade;
    el.grade.style.color = acc >= 95 ? '#ff2e88' : acc >= 88 ? '#2fc9b8'
                         : acc >= 78 ? '#5f9cff' : '#b87fa6';
    el.rScore.textContent = current.score;
    el.rAcc.textContent = '정확도 ' + acc.toFixed(2) + '% · 최대 콤보 ' + current.maxCombo +
                          (c.bomb ? ' · 폭탄 ' + c.bomb + '회' : '');
    el.sP.textContent = c.perfect; el.sG.textContent = c.great;
    el.sO.textContent = c.good;    el.sM.textContent = c.miss;

    // localStorage throws on some file:// origins — never let that kill the
    // result screen. The key is v2's own, so v1 scores are not overwritten.
    var key = 'heartbeat.v2d.best.' + RG.song.label + '.' + RG.settings.diff;
    var best = 0;
    try { best = parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch (err) {}
    if (current.score > best) {
      try { localStorage.setItem(key, String(current.score)); } catch (err) {}
      el.rBest.textContent = '🏆 신기록! (이전 최고 ' + best + ')';
    } else {
      el.rBest.textContent = '이 곡 최고 점수: ' + best;
    }

    el.resultOverlay.classList.remove('hidden');
  }

  function toMenu() {
    if (current) current.ended = true;
    stopSource();
    clearHolds();
    if (rafId) cancelAnimationFrame(rafId);
    current = null;
    RG.game.current = null;

    el.pauseBtn.classList.add('hidden');
    el.pauseOverlay.classList.add('hidden');
    el.resultOverlay.classList.add('hidden');
    el.menuOverlay.classList.remove('hidden');
    el.progressFill.style.width = '0%';
    RG.render.clear();
  }

  RG.game = {
    current: null,
    start: start, pause: pause, resume: resume, togglePause: togglePause,
    toMenu: toMenu, songTime: songTime, approachTime: approachTime
  };
})();
