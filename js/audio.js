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

  // A key press is not a pitch, so lanes are told apart by resonance rather than by
  // note: a slightly different case tone and click brightness each, the way keys in
  // different positions on a board sound slightly different.
  var LANE_BODY_HZ  = [240, 290, 350, 420];        // case / plate resonance
  var LANE_CLICK_HZ = [5200, 5800, 6400, 7000];    // switch click brightness

  // A mechanical switch in three layers, all over inside ~70ms. Everything here is
  // noise and a short thump — nothing sustains, which is exactly why it punches
  // instead of blending into the music the way a tuned chime did.
  function tap(kind, lane) {
    var c = ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime, out = hitBus();
    var body = LANE_BODY_HZ[lane] || 290;
    var level = kind === 'perfect' ? 1 : kind === 'great' ? 0.85 : 0.68;

    // 1. The click itself: a couple of milliseconds of very bright noise.
    var click = noise();
    var hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = LANE_CLICK_HZ[lane] || 5800;
    var clickEnv = c.createGain();
    clickEnv.gain.setValueAtTime(0.0001, now);
    clickEnv.gain.exponentialRampToValueAtTime(0.5 * level, now + 0.0008);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
    click.connect(hp).connect(clickEnv).connect(out);
    click.start(now);
    click.stop(now + 0.02);

    // 2. The "thock": noise rung through a narrow band. The high Q is what turns
    // flat noise into a hollow plastic case rather than a hiss.
    var shell = noise();
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = body;
    bp.Q.value = 4.5;
    var shellEnv = c.createGain();
    shellEnv.gain.setValueAtTime(0.0001, now);
    shellEnv.gain.exponentialRampToValueAtTime(0.75 * level, now + 0.002);
    shellEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    shell.connect(bp).connect(shellEnv).connect(out);
    shell.start(now);
    shell.stop(now + 0.07);

    // 3. Bottom-out: a fast low thump so the press lands with weight.
    var thump = c.createOscillator();
    var thumpEnv = c.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(body * 0.5, now);
    thump.frequency.exponentialRampToValueAtTime(body * 0.32, now + 0.04);
    thumpEnv.gain.setValueAtTime(0.0001, now);
    thumpEnv.gain.exponentialRampToValueAtTime(0.4 * level, now + 0.003);
    thumpEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    thump.connect(thumpEnv).connect(out);
    thump.start(now);
    thump.stop(now + 0.07);
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
  // The hold tone stays tonal even though the taps are not: it has to be
  // distinguishable while it sustains, and a sustained noise would just be hiss.
  // Pentatonic, low enough to sit under the key clicks rather than fight them.
  var HOLD_HZ = [392.00, 523.25, 659.25, 783.99];   // G4 C5 E5 G5
  function holdHz(lane) { return HOLD_HZ[lane] || 523.25; }

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
