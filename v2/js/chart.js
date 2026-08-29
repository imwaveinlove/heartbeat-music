/* chart.js — turns an AudioBuffer into a playable grid chart.
 *
 * The analysis half is v1's and unchanged: render the song through four band
 * filters, find each band's onsets, then greedily keep the strongest ones that
 * still satisfy the spacing rules until the difficulty's note budget is full.
 *
 * What is new is everything after that. v1 handed the picked onsets straight to
 * four lanes; here each one also needs a note kind and — for a slash — a
 * direction that flows out of the previous one instead of fighting it.
 */
(function () {
  'use strict';

  var C = RG.config;

  function renderBand(buffer, band) {
    var len = Math.ceil(buffer.duration * C.ANALYSIS_RATE);
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var off = new OC(1, len, C.ANALYSIS_RATE);
    var src = off.createBufferSource();
    src.buffer = buffer;
    var f = off.createBiquadFilter();
    f.type = band.type;
    f.frequency.value = band.freq;
    f.Q.value = band.q;
    src.connect(f).connect(off.destination);
    src.start(0);
    return off.startRendering();
  }

  // Energy envelope, rectified flux, then adaptive-threshold peak picking.
  function detectOnsets(channelData, sampleRate) {
    var HOP = C.HOP;
    var frames = Math.floor(channelData.length / HOP);
    var energy = new Float32Array(frames);
    for (var i = 0; i < frames; i++) {
      var s = 0, start = i * HOP, end = start + HOP;
      for (var j = start; j < end; j++) { var v = channelData[j]; s += v * v; }
      energy[i] = Math.log(1 + Math.sqrt(s / HOP) * 400);
    }

    var flux = new Float32Array(frames);
    for (var k = 1; k < frames; k++) {
      var d = energy[k] - energy[k - 1];
      flux[k] = d > 0 ? d : 0;
    }

    var win = 22;
    var peaks = [];
    for (var m = 2; m < frames - 2; m++) {
      var lo = Math.max(0, m - win), hi = Math.min(frames - 1, m + win);
      var sum = 0;
      for (var n = lo; n <= hi; n++) sum += flux[n];
      var thresh = (sum / (hi - lo + 1)) * 1.9 + 0.012;
      if (flux[m] > thresh &&
          flux[m] >= flux[m - 1] && flux[m] >= flux[m + 1] &&
          flux[m] >= flux[m - 2] && flux[m] >= flux[m + 2]) {
        peaks.push({
          time: (m * HOP) / sampleRate,
          strength: flux[m],
          sustain: sustainAfter(energy, m, HOP, sampleRate)
        });
      }
    }
    return peaks;
  }

  // How long the band keeps ringing after an onset, measured against the onset's
  // own level. This is what decides which notes are worth turning into holds.
  function sustainAfter(energy, at, HOP, sampleRate) {
    var frames = energy.length;
    var peakLevel = energy[at];
    if (peakLevel <= 0) return 0;
    var floor = peakLevel * 0.55;
    var i = at + 1;
    var maxFrames = Math.ceil((C.HOLD.MEASURE_MAX * sampleRate) / HOP);
    var quiet = 0;
    while (i < frames && i - at < maxFrames) {
      if (energy[i] >= floor) quiet = 0;
      else if (++quiet > 3) break;       // tolerate brief dips inside one note
      i++;
    }
    return ((i - quiet - at) * HOP) / sampleRate;
  }

  function thinByGap(list, gap) {
    var out = [], last = -Infinity;
    for (var i = 0; i < list.length; i++) {
      if (list[i].time - last >= gap) { out.push(list[i]); last = list[i].time; }
    }
    return out;
  }

  function insertSorted(arr, t) {
    var lo = 0, hi = arr.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] < t) lo = mid + 1; else hi = mid; }
    arr.splice(lo, 0, t);
  }

  function nearestGap(arr, t) {
    var lo = 0, hi = arr.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] < t) lo = mid + 1; else hi = mid; }
    var best = Infinity;
    if (lo < arr.length) best = Math.min(best, arr[lo] - t);
    if (lo > 0) best = Math.min(best, t - arr[lo - 1]);
    return best;
  }

  // ---------- holds ----------
  // How far a tail may run is what actually decides how hard a chart feels. With
  // soloHold on, a tail may not overlap a note in ANY column, so a hold is always
  // played on its own; with it off, the other columns keep firing while a finger
  // is pinned in place.
  //
  // The catch is that "place a hold only where there happens to be room" yields
  // almost none: at NORMAL's density the gap between two notes is about 0.36s and
  // a tail needs 0.34s plus clearance, so the budget goes unspent and the level
  // that is supposed to introduce holds shows five in a whole song. So a tail is
  // allowed to *make* its room, dropping up to two taps that stand in its way —
  // which is what a human charter does when writing a sustain in.
  function assignHolds(notes, cfg, soloHold) {
    var budget = Math.floor(notes.length * (cfg.holdShare || 0));
    if (budget < 1 || !cfg.holdMax) return notes;

    var MAX_REMOVE = 2;
    var order = notes.slice().sort(function (a, b) { return b.sustain - a.sustain; });
    var placed = 0;

    for (var i = 0; i < order.length && placed < budget; i++) {
      var n = order[i];
      if (n.removed || n.type !== C.SLASH) continue;
      // Sorted by sustain, so once the longest remaining note is too short to
      // hold, so is everything after it.
      if (Math.min(n.sustain, cfg.holdMax) < C.HOLD.MIN) break;

      // What the tail would have to run over, nearest first.
      var after = [];
      for (var j = 0; j < notes.length; j++) {
        var m = notes[j];
        if (m === n || m.removed || m.time <= n.time) continue;
        if (!soloHold && m.col !== n.col) continue;
        after.push(m);
      }
      after.sort(function (a, b) { return a.time - b.time; });

      // Room if the nearest k of them were dropped. k = 0 first, so a tail only
      // removes notes when it genuinely cannot fit around them.
      var drop = -1, tail = 0;
      for (var k = 0; k <= MAX_REMOVE && k <= after.length; k++) {
        if (k > 0 && after[k - 1].type !== C.SLASH) break;   // never eat another hold
        var next = after[k];
        var gap = next ? (next.col === n.col ? cfg.cellGap : cfg.globalGap) : 0;
        var room = next ? next.time - gap - n.time : cfg.holdMax;
        var t = Math.min(n.sustain, cfg.holdMax, room);
        if (t >= C.HOLD.MIN) { drop = k; tail = t; break; }
      }
      if (drop < 0) continue;

      for (var d = 0; d < drop; d++) after[d].removed = true;
      n.type = C.HOLD;
      n.hold = tail;
      n.holdEnd = n.time + tail;
      placed++;
    }

    return notes.filter(function (n) { return !n.removed; });
  }

  // ---------- directions ----------
  // Every playable note is a slash, so the only question left is which way. It is
  // not a random one.
  //
  // On EASY the arrows just alternate down and up within a hand, so the finger
  // saws instead of being asked to flick the same way twice from a position it
  // never returned to.
  //
  // From NORMAL the horizontal arrows carry the choreography: if the next note
  // this hand plays is in the cell to the right, this note's arrow IS right, so
  // flicking it leaves the finger already travelling toward where it has to be.
  // That turns the arrow from a second thing to read into an instruction the
  // player was going to need anyway, which is why four directions came out
  // easier than two rather than harder.
  function flowDirections(notes, dirSet, perHand) {
    // With one pointer there are no hands to speak of — the cursor follows a
    // single path, so the guidance is computed over the whole sequence.
    function handOf(n) { return perHand ? (n.col < 2 ? 0 : 1) : 0; }

    var goingDown = [true, true];

    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (n.type !== C.SLASH) continue;
      var hand = handOf(n);

      // The next note this hand will actually play. Holds count — the finger has
      // to travel to them too. Bombs are inserted later and are never a target.
      var next = null;
      for (var j = i + 1; j < notes.length; j++) {
        if (handOf(notes[j]) === hand) { next = notes[j]; break; }
      }

      if (dirSet === 'cardinal4' && next && next.col !== n.col) {
        n.dir = next.col > n.col ? C.DIR_RIGHT : C.DIR_LEFT;
        // A sideways flick does not use up the vertical alternation, so the saw
        // picks up where it left off the next time the hand stays in one cell.
      } else {
        n.dir = goingDown[hand] ? C.DIR_DOWN : C.DIR_UP;
        goingDown[hand] = !goingDown[hand];
      }
    }
  }

  // ---------- bombs ----------
  // A bomb goes just after a note, in the cell next door — right where a finger
  // sliding toward the next note would drift through. It has to sit somewhere the
  // player might actually go, or it is only decoration.
  function insertBombs(notes, cfg) {
    var budget = Math.floor(notes.length * (cfg.bombShare || 0));
    if (budget < 1) return notes;

    var occupied = [[], [], [], []], everywhere = [];
    notes.forEach(function (n) {
      insertSorted(occupied[n.col], n.time);
      insertSorted(everywhere, n.time);
    });

    // A quarter to half a second after the note is the window where the finger is
    // still moving away from it. Which of those offsets is free depends on how
    // busy the chart is around here, so try them in order of preference rather
    // than insisting on one — at HARD's spacing a single fixed offset lands on
    // another note almost every time and nearly all the bombs get dropped.
    var OFFSETS = [0.30, 0.37, 0.25, 0.44, 0.50];
    // Bombs are spread by time, not by note index: every note gets offered a slot
    // and most of them fail the spacing checks, so striding through the list by a
    // fixed step just means the budget never fills at HARD's density.
    var span = notes[notes.length - 1].time - notes[0].time;
    var spacing = span / Math.max(1, budget);
    var lastBomb = -99;
    var bombs = [];
    for (var i = 2; i < notes.length - 1 && bombs.length < budget; i++) {
      var n = notes[i];
      if (n.type === C.HOLD) continue;
      if (n.time - lastBomb < spacing) continue;
      var col = n.col < 3 ? n.col + 1 : n.col - 1;
      var at = -1;
      for (var o = 0; o < OFFSETS.length; o++) {
        var cand = n.time + OFFSETS[o];
        if (nearestGap(occupied[col], cand) < 0.34) continue;
        // Also clear of every other column, by the same margin the notes keep
        // between themselves. A bomb landing at the same instant as a note
        // somewhere else is two objects arriving as one, and the player has to
        // hit one and dodge the other — unreadable rather than hard.
        if (nearestGap(everywhere, cand) < Math.max(0.09, cfg.globalGap)) continue;
        at = cand;
        break;
      }
      if (at < 0) continue;
      lastBomb = at;
      insertSorted(occupied[col], at);
      insertSorted(everywhere, at);
      bombs.push({
        time: at, col: col, row: 0,
        type: C.BOMB, dir: 0, strength: 0, sustain: 0, hold: 0, holdEnd: 0
      });
    }

    return notes.concat(bombs).sort(function (a, b) { return a.time - b.time; });
  }

  // Resolves to the chart: [{time, col, row, type, dir, hold, holdEnd}], by time.
  function build(buffer, diffKey, onProgress) {
    var cfg = C.DIFFS[diffKey];
    var mode = C.INPUT[RG.settings.input] || C.INPUT.touch;
    // A tail pins one of only two thumbs. With a mouse there is a single pointer
    // to begin with, so a hold there always plays alone whatever the level says.
    var soloHold = cfg.soloHold || RG.settings.input === 'mouse';
    var all = [];
    var colIndex = 0;

    function step() {
      if (colIndex >= C.COLS) return Promise.resolve(finalize());
      var thisCol = colIndex;
      return renderBand(buffer, C.BAND_DEFS[thisCol]).then(function (rendered) {
        var peaks = thinByGap(detectOnsets(rendered.getChannelData(0), rendered.sampleRate), 0.05);
        for (var i = 0; i < peaks.length; i++) {
          all.push({
            time: peaks[i].time, col: thisCol,
            strength: peaks[i].strength, sustain: peaks[i].sustain
          });
        }
        colIndex++;
        if (onProgress) onProgress(colIndex / C.COLS);
        return step();
      });
    }

    function finalize() {
      var budget = Math.round(buffer.duration * cfg.nps * mode.npsScale);
      var globalGap = Math.max(cfg.globalGap, mode.gapFloor);
      all.sort(function (a, b) { return b.strength - a.strength; });

      var colTimes = [[], [], [], []], globalTimes = [], chosen = [];
      for (var i = 0; i < all.length && chosen.length < budget; i++) {
        var nt = all[i];
        if (nt.time < 0.35) continue;                       // skip the very intro
        if (nearestGap(colTimes[nt.col], nt.time) < cfg.cellGap) continue;
        if (nearestGap(globalTimes, nt.time) < globalGap) continue;
        // On a phone one thumb owns columns 0-1 and the other 2-3, so a note is
        // only reachable if that thumb is not still busy next door.
        if (mode.handGap && nearestGap(colTimes[nt.col ^ 1], nt.time) < mode.handGap) continue;
        insertSorted(colTimes[nt.col], nt.time);
        insertSorted(globalTimes, nt.time);
        chosen.push({
          time: nt.time, col: nt.col, row: 0, type: C.SLASH, dir: C.DIR_DOWN,
          strength: nt.strength, sustain: nt.sustain || 0, hold: 0, holdEnd: 0
        });
      }
      chosen.sort(function (a, b) { return a.time - b.time; });

      chosen = assignHolds(chosen, cfg, soloHold);
      flowDirections(chosen, cfg.dirSet, RG.settings.input === 'touch');
      chosen = insertBombs(chosen, cfg);
      chosen.forEach(function (n) { delete n.strength; delete n.sustain; });
      return chosen;
    }

    return step();
  }

  RG.chart = { build: build };
})();
