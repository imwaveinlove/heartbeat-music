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
        peaks.push({ time: (m * HOP) / sampleRate, strength: flux[m] });
      }
    }
    return peaks;
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
          all.push({ time: peaks[i].time, lane: thisLane, strength: peaks[i].strength });
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
        chosen.push({ time: nt.time, lane: nt.lane, hit: false, judged: false });
      }
      chosen.sort(function (a, b) { return a.time - b.time; });
      return chosen;
    }

    return step();
  }

  RG.chart = { build: build };
})();
