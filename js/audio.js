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

  // White noise, generated once and re-triggered per hit. Used only for the mallet
  // strike at the very start of a note — the part that makes a bar sound struck.
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

  // Major pentatonic, so any combination of lanes hit together still sounds
  // consonant. Sitting an octave up from a xylophone's range is what makes it read
  // as glass rather than wood — it only works because the decay is this short.
  var LANE_HZ = [783.99, 1046.50, 1318.51, 1567.98];   // G5 C6 E6 G6

  // One partial of the chime. Octave-related partials (2f, 3f) stay glassy; the
  // twelfth-heavy ratio a xylophone uses is what made the old sound woody.
  function partial(c, freq, peak, decay, now, out) {
    var osc = c.createOscillator();
    var env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(env).connect(out);
    osc.start(now);
    osc.stop(now + decay + 0.02);
  }

  // Three layers, all done inside ~0.2s: a soft click for contact, a bubbly upward
  // blip for bounce, and a short sweet chime on top. Kept brief on purpose — this
  // fires hundreds of times per song and anything longer turns into mush.
  function tap(kind, lane) {
    var c = ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime, out = hitBus();
    var f = LANE_HZ[lane] || 1046.50;
    var level = kind === 'perfect' ? 1 : kind === 'great' ? 0.82 : 0.64;

    // Soft click. Band-passed rather than high-passed so it lands as a tick
    // instead of a hiss.
    var src = noise();
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3600;
    bp.Q.value = 0.9;
    var clickEnv = c.createGain();
    clickEnv.gain.setValueAtTime(0.0001, now);
    clickEnv.gain.exponentialRampToValueAtTime(0.22 * level, now + 0.001);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.013);
    src.connect(bp).connect(clickEnv).connect(out);
    src.start(now);
    src.stop(now + 0.02);

    // Bubbly sparkle: a fast upward sweep. This is the part that makes the hit feel
    // bouncy and playful rather than just bright.
    var pop = c.createOscillator();
    var popEnv = c.createGain();
    pop.type = 'sine';
    pop.frequency.setValueAtTime(f * 0.55, now);
    pop.frequency.exponentialRampToValueAtTime(f * 1.02, now + 0.045);
    popEnv.gain.setValueAtTime(0.0001, now);
    popEnv.gain.exponentialRampToValueAtTime(0.34 * level, now + 0.004);
    popEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    pop.connect(popEnv).connect(out);
    pop.start(now);
    pop.stop(now + 0.12);

    partial(c, f,     0.30 * level, 0.20, now, out);   // chime body
    partial(c, f * 2, 0.14 * level, 0.14, now, out);   // shine
    partial(c, f * 3, 0.05 * level, 0.09, now, out);   // a touch of air
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
  // A quiet tone runs for as long as a hold is kept, so the player can hear that
  // they are still on it without watching the tail. It sits an octave below the
  // struck notes so it never muddies the xylophone hits on top of it.
  var holdVoices = {};
  function holdHz(lane) { return (LANE_HZ[lane] || 523.25) / 2; }

  function holdStart(lane) {
    var c = ctx();
    if (c.state !== 'running' || holdVoices[lane]) return;
    var now = c.currentTime;
    var osc = c.createOscillator();
    var env = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(holdHz(lane), now);
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
    osc.frequency.setValueAtTime(holdHz(lane), now);
    osc.frequency.exponentialRampToValueAtTime(holdHz(lane) * 2, now + 0.07);
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
