/* chart.js — turns an AudioBuffer into a playable 4-lane chart.
 *
 * The song is rendered four times through different band filters (one per lane),
 * each band's onsets are detected from its energy envelope, and the strongest
 * onsets are then packed into the difficulty's note budget without ever placing
 * two notes closer than the spacing rules allow.
 */
(function () {
  'use strict';

  var C = RG.config;

  // Render the song through one band filter, downsampled for speed.
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

  // Energy envelope → rectified flux → adaptive-threshold peak picking.
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
      var mean = sum / (hi - lo + 1);
      var thresh = mean * 1.9 + 0.012;
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

  // How long the band keeps ringing after an onset. Measured against the onset's
  // own level rather than a fixed floor, so a quiet sustained pad counts just as
  // much as a loud one. This is what decides which notes become holds.
  function sustainAfter(energy, at, HOP, sampleRate) {
    var frames = energy.length;
    var peakLevel = energy[at];
    if (peakLevel <= 0) return 0;
    var floor = peakLevel * 0.55;
    var i = at + 1;
    var maxFrames = Math.ceil((C.HOLD.MEASURE_MAX * sampleRate) / HOP);
    var quiet = 0;
    while (i < frames && i - at < maxFrames) {
      if (energy[i] >= floor) {
        quiet = 0;
      } else if (++quiet > 3) {      // tolerate brief dips inside a sustained note
        break;
      }
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

  // Resolves to [{time, lane, hit, judged}], sorted by time.
  function build(buffer, diffKey, onProgress) {
    var cfg = C.DIFFS[diffKey];
    var all = [];
    var laneIndex = 0;

    function step() {
      if (laneIndex >= C.LANES) return Promise.resolve(finalize());

      var band = C.BAND_DEFS[laneIndex];
      var thisLane = laneIndex;
      return renderBand(buffer, band).then(function (rendered) {
        var peaks = detectOnsets(rendered.getChannelData(0), rendered.sampleRate);
        peaks = thinByGap(peaks, 0.05);   // dedupe only; spacing is enforced in finalize()
        for (var i = 0; i < peaks.length; i++) {
          all.push({
            time: peaks[i].time, lane: thisLane,
            strength: peaks[i].strength, sustain: peaks[i].sustain
          });
        }
        laneIndex++;
        if (onProgress) onProgress(laneIndex / C.LANES);
        return step();
      });
    }

    function finalize() {
      // Greedy: take the strongest onsets first, keeping only those that still
      // satisfy the spacing rules, until the difficulty's note budget is full.
      // (Trimming to budget *before* spacing would drop notes twice and leave
      // the chart far sparser than the difficulty asks for.)
      var budget = Math.round(buffer.duration * cfg.nps);
      all.sort(function (a, b) { return b.strength - a.strength; });

      var laneTimes = [[], [], [], []], globalTimes = [], chosen = [];
      for (var i = 0; i < all.length && chosen.length < budget; i++) {
        var nt = all[i];
        if (nt.time < 0.35) continue;                      // skip the very intro
        if (nearestGap(laneTimes[nt.lane], nt.time) < cfg.laneGap) continue;
        if (nearestGap(globalTimes, nt.time) < cfg.globalGap) continue;
        insertSorted(laneTimes[nt.lane], nt.time);
        insertSorted(globalTimes, nt.time);
        chosen.push({
          time: nt.time, lane: nt.lane, hit: false, judged: false,
          sustain: nt.sustain || 0
        });
      }
      chosen.sort(function (a, b) { return a.time - b.time; });
      assignHolds(chosen);
      return chosen;
    }

    // Turn the longest-ringing notes into holds, within the difficulty's budget.
    //
    // How far a tail may run is the whole difficulty story. On easy/normal it must
    // clear the next note in ANY lane, so a hold is always played alone; on hard it
    // only has to clear its own lane, and other lanes keep firing while you hold.
    function assignHolds(notes) {
      var budget = Math.floor(notes.length * (cfg.holdShare || 0));
      if (budget < 1 || !cfg.holdMax) {
        notes.forEach(function (n) { delete n.sustain; });
        return;
      }

      var nextInLane = [null, null, null, null];
      var nextAny = null;
      for (var i = notes.length - 1; i >= 0; i--) {
        var n = notes[i];
        var laneRoom = nextInLane[n.lane] === null
          ? cfg.holdMax
          : Math.max(0, nextInLane[n.lane] - n.time - cfg.laneGap);
        var anyRoom = nextAny === null
          ? cfg.holdMax
          : Math.max(0, nextAny - n.time - cfg.globalGap);
        n.maxTail = cfg.soloHold ? Math.min(laneRoom, anyRoom) : laneRoom;
        nextInLane[n.lane] = n.time;
        nextAny = n.time;
      }

      // Longest sustain wins the limited number of hold slots.
      notes.slice()
        .sort(function (a, b) { return b.sustain - a.sustain; })
        .slice(0, budget)
        .forEach(function (n) {
          var tail = Math.min(n.sustain, n.maxTail, cfg.holdMax);
          if (tail >= C.HOLD.MIN) {
            n.hold = tail;
            n.holdEnd = n.time + tail;
          }
        });

      notes.forEach(function (n) { delete n.maxTail; delete n.sustain; });
    }

    return step();
  }

  RG.chart = { build: build };
})();
