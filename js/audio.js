/* audio.js — the shared AudioContext and the note hit sounds.
 *
 * Hit sounds are synthesised rather than loaded from files: they must fire the
 * instant a key is judged, and a sample fetched over the network (or decoded on
 * demand) would add latency exactly where it is most audible.
 */
(function () {
  'use strict';

  var audioCtx = null;

  // Must be called from inside a user gesture the first time: mobile browsers
  // start the context suspended until a real tap resumes it.
  function ctx() {
    if (!audioCtx) {
      var C = window.AudioContext || window.webkitAudioContext;
      audioCtx = new C();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // One shared bus for every hit sound. Without it a dense stream of notes stacks
  // gain and clips against the song. The compressor only catches peaks — at the
  // default threshold/ratio it squashes every hit and they disappear under the music.
  var bus = null;
  function hitBus() {
    var c = ctx();
    if (!bus) {
      var comp = c.createDynamicsCompressor();
      comp.threshold.value = -8;
      comp.knee.value = 6;
      comp.ratio.value = 3;
      comp.attack.value = 0.002;
      comp.release.value = 0.15;
      var g = c.createGain();
      g.gain.value = 1.0;
      g.connect(comp).connect(c.destination);
      bus = g;
    }
    return bus;
  }

  // White noise, generated once and re-triggered per hit. A hit sound has to cut
  // through the song, and a filtered noise transient does that where a tonal pluck
  // just blends in — percussion reads as rhythm, a pitched blip reads as melody.
  var noiseBuf = null;
  function noise() {
    var c = ctx();
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.25), c.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var src = c.createBufferSource();
    src.buffer = noiseBuf;
    return src;
  }

  // Only the click's timbre shifts per lane — enough to tell them apart without
  // turning the hits into a tune that fights the music.
  var LANE_CLICK_HZ = [2000, 2500, 3100, 3800];

  function tap(kind, lane) {
    var c = ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime, out = hitBus();
    var level = kind === 'perfect' ? 1 : kind === 'great' ? 0.82 : 0.62;

    // Crisp transient: a very short band-passed noise burst.
    var src = noise();
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = LANE_CLICK_HZ[lane] || 2500;
    bp.Q.value = 1.1;
    var env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.85 * level, now + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    src.connect(bp).connect(env).connect(out);
    src.start(now);
    src.stop(now + 0.06);

    // Body: a fast pitch drop gives the tap weight so it lands like a drum.
    var body = c.createOscillator();
    var bodyEnv = c.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(320, now);
    body.frequency.exponentialRampToValueAtTime(140, now + 0.055);
    bodyEnv.gain.setValueAtTime(0.0001, now);
    bodyEnv.gain.exponentialRampToValueAtTime(0.6 * level, now + 0.003);
    bodyEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    body.connect(bodyEnv).connect(out);
    body.start(now);
    body.stop(now + 0.1);
  }

  function tapMiss() {
    var c = ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime;
    var osc = c.createOscillator();
    var env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.14);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.3, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
    osc.connect(env).connect(hitBus());
    osc.start(now);
    osc.stop(now + 0.2);
  }

  // ---------- hold notes ----------
  // A quiet tone runs for as long as a hold is being kept, so the player can hear
  // that they are still on it without watching the tail.
  var holdVoices = {};
  var HOLD_HZ = [392.0, 523.25, 659.25, 783.99];   // G4 C5 E5 G5

  function holdStart(lane) {
    var c = ctx();
    if (c.state !== 'running' || holdVoices[lane]) return;
    var now = c.currentTime;
    var osc = c.createOscillator();
    var env = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(HOLD_HZ[lane] || 523.25, now);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
    osc.connect(env).connect(hitBus());
    osc.start(now);
    holdVoices[lane] = { osc: osc, env: env };
  }

  function holdStop(lane) {
    var v = holdVoices[lane];
    if (!v) return;
    delete holdVoices[lane];
    var c = ctx();
    var now = c.currentTime;
    try {
      v.env.gain.cancelScheduledValues(now);
      v.env.gain.setValueAtTime(Math.max(v.env.gain.value, 0.0001), now);
      v.env.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      v.osc.stop(now + 0.07);
    } catch (e) {}
  }

  function holdStopAll() {
    Object.keys(holdVoices).forEach(function (lane) { holdStop(lane); });
  }

  // Bright confirmation when a hold is carried all the way to its tail.
  function holdComplete(lane) {
    var c = ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime;
    var osc = c.createOscillator();
    var env = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(HOLD_HZ[lane] || 523.25, now);
    osc.frequency.exponentialRampToValueAtTime((HOLD_HZ[lane] || 523.25) * 1.5, now + 0.07);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.4, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(env).connect(hitBus());
    osc.start(now);
    osc.stop(now + 0.2);
  }

  RG.audio = {
    ctx: ctx, tap: tap, tapMiss: tapMiss,
    holdStart: holdStart, holdStop: holdStop, holdStopAll: holdStopAll,
    holdComplete: holdComplete
  };
})();
