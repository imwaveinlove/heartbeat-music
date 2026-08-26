/* game.js — playback clock, judgement, the frame loop, and input.
 *
 * Timing is driven by the AudioContext clock rather than rAF timestamps, so
 * judgement stays locked to the audio even if frames drop.
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

  function registerHit(kind, lane) {
    var g = current;
    if (kind === 'miss') {
      g.counts.miss++;
      g.combo = 0;
      fx.judge = { label: 'MISS', color: '#b87fa6', at: performance.now() };
    } else {
      g.counts[kind]++;
      g.combo++;
      if (g.combo > g.maxCombo) g.maxCombo = g.combo;
      var mult = 1 + Math.min(g.combo, 100) * 0.005;
      g.score += Math.round(C.SCORES[kind] * mult);
      g.weighted += C.SCORES[kind];
      var col = kind === 'perfect' ? '#ff2e88' : kind === 'great' ? '#2fc9b8' : '#5f9cff';
      fx.judge = { label: kind.toUpperCase(), color: col, at: performance.now() };
      fx.hits.push({ lane: lane, at: performance.now(), color: col });
    }
    updateHud();
  }

  // Judge a tap against the closest unjudged note in that lane.
  function pressLane(lane) {
    if (!current || current.paused || current.ended) return;
    fx.laneFlash[lane] = performance.now();

    var t = songTime();
    var best = null, bestDiff = Infinity;
    var notes = current.notes;
    for (var i = current.missPointer; i < notes.length; i++) {
      var n = notes[i];
      if (n.time > t + C.WINDOWS.good) break;
      if (n.judged || n.lane !== lane) continue;
      var d = Math.abs(n.time - t);
      if (d < bestDiff) { bestDiff = d; best = n; }
    }
    if (!best || bestDiff > C.WINDOWS.good) return;

    best.judged = true; best.hit = true;
    registerHit(bestDiff <= C.WINDOWS.perfect ? 'perfect'
              : bestDiff <= C.WINDOWS.great   ? 'great' : 'good', lane);
  }

  function loop() {
    if (!current || current.ended) return;
    if (current.paused) { rafId = requestAnimationFrame(loop); return; }

    var t = songTime();

    // notes that fell past the window are misses
    var notes = current.notes;
    while (current.missPointer < notes.length && notes[current.missPointer].time < t - C.WINDOWS.miss) {
      var n = notes[current.missPointer];
      if (!n.judged) { n.judged = true; registerHit('miss', n.lane); }
      current.missPointer++;
    }

    RG.render.draw(t);
    el.progressFill.style.width = Math.max(0, Math.min(t / RG.song.buffer.duration, 1)) * 100 + '%';

    if (t > RG.song.buffer.duration + 0.6) { end(); return; }
    rafId = requestAnimationFrame(loop);
  }

  // ---------- lifecycle ----------
  function start() {
    if (!RG.song.chart || !RG.song.chart.length) return;

    current = {
      notes: RG.song.chart.map(function (n) {
        return { time: n.time, lane: n.lane, hit: false, judged: false };
      }),
      total: RG.song.chart.length,
      score: 0, combo: 0, maxCombo: 0,
      counts: { perfect: 0, great: 0, good: 0, miss: 0 },
      weighted: 0, missPointer: 0,
      paused: false, ended: false,
      startAt: 0, pausedAt: 0
    };
    RG.game.current = current;

    fx.hits = []; fx.judge = null;
    fx.laneFlash = [0, 0, 0, 0];

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

  function pause() {
    if (!current || current.paused || current.ended) return;
    current.paused = true;
    current.pausedAt = songTime();
    stopSource();
    el.pauseOverlay.classList.remove('hidden');
  }

  function resume() {
    if (!current || !current.paused) return;
    el.pauseOverlay.classList.add('hidden');
    current.paused = false;
    var from = Math.max(0, current.pausedAt);
    playFrom(from);
    // rewind the miss pointer so notes near the resume point are live again
    while (current.missPointer > 0 && current.notes[current.missPointer - 1].time > from - C.WINDOWS.miss) {
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
    el.rAcc.textContent = '정확도 ' + acc.toFixed(2) + '% · 최대 콤보 ' + current.maxCombo;
    el.sP.textContent = c.perfect; el.sG.textContent = c.great;
    el.sO.textContent = c.good;    el.sM.textContent = c.miss;

    // localStorage throws on some file:// origins — never let that kill the result screen.
    var key = 'rhythm4key.best.' + RG.song.label + '.' + RG.settings.diff;
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

  // ---------- input ----------
  window.addEventListener('keydown', function (e) {
    var idx = C.KEYS.indexOf(e.code);
    if (idx >= 0) {
      e.preventDefault();
      if (fx.keyHeld[idx]) return;   // ignore auto-repeat
      fx.keyHeld[idx] = true;
      pressLane(idx);
    } else if (e.code === 'Escape') {
      togglePause();
    }
  });
  window.addEventListener('keyup', function (e) {
    var idx = C.KEYS.indexOf(e.code);
    if (idx >= 0) fx.keyHeld[idx] = false;
  });

  // Touch: each finger is tracked separately so chords on multiple lanes work.
  var activePointers = {};
  el.cv.addEventListener('pointerdown', function (e) {
    if (!current || current.paused || current.ended) return;
    e.preventDefault();
    var rect = el.cv.getBoundingClientRect();
    var lane = Math.floor(((e.clientX - rect.left) / rect.width) * C.LANES);
    lane = Math.max(0, Math.min(C.LANES - 1, lane));
    activePointers[e.pointerId] = lane;
    fx.keyHeld[lane] = true;
    pressLane(lane);
  });
  function releasePointer(e) {
    var lane = activePointers[e.pointerId];
    if (lane != null) { fx.keyHeld[lane] = false; delete activePointers[e.pointerId]; }
  }
  // released on window: a finger that slides off the canvas must not stick the pad down
  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);

  RG.game = {
    current: null,
    start: start, pause: pause, resume: resume, togglePause: togglePause,
    toMenu: toMenu, pressLane: pressLane,
    songTime: songTime, approachTime: approachTime
  };
})();
