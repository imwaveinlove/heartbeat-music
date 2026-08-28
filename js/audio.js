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

  // Jingle bands, one per lane. A tambourine has no pitch to speak of, so lanes are
  // told apart by how bright their shimmer sits rather than by note.
  var LANE_JINGLE_HZ = [3200, 3700, 4300, 5000];

  // Small metal discs ring at ratios that are deliberately not whole numbers —
  // that inharmonicity is what makes a jingle sound like metal instead of a chime.
  var JINGLE_RATIOS = [1, 1.42, 1.87, 2.34];

  // One tambourine strike, in three parts. Both taps and hold completions go
  // through here, so they are unmistakably the same instrument on the same lane —
  // only the timing and tail length differ between them.
  function strike(c, out, at, base, level, tail) {
    // 1. Jingle shimmer: bright noise, rung and left to decay. Longer than a click
    // because the discs keep rattling after the hit.
    var shimmer = noise();
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = base * 1.6;
    bp.Q.value = 0.8;
    var shimmerEnv = c.createGain();
    shimmerEnv.gain.setValueAtTime(0.0001, at);
    shimmerEnv.gain.exponentialRampToValueAtTime(0.55 * level, at + 0.002);
    shimmerEnv.gain.exponentialRampToValueAtTime(0.0001, at + tail);
    shimmer.connect(bp).connect(shimmerEnv).connect(out);
    shimmer.start(at);
    shimmer.stop(at + tail + 0.02);

    // 2. The discs themselves: a few inharmonic partials, each fading at its own
    // rate so the shimmer breaks up instead of ringing as one tone.
    for (var i = 0; i < JINGLE_RATIOS.length; i++) {
      var osc = c.createOscillator();
      var env = c.createGain();
      var decay = (0.05 + i * 0.022) * (tail / 0.13);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * JINGLE_RATIOS[i], at);
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime((0.14 - i * 0.025) * level, at + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      osc.connect(env).connect(out);
      osc.start(at);
      osc.stop(at + decay + 0.02);
    }

    // 3. Hand contact: a soft low-mid thud so the hit has a body under the shimmer.
    var hand = noise();
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    var handEnv = c.createGain();
    handEnv.gain.setValueAtTime(0.0001, at);
    handEnv.gain.exponentialRampToValueAtTime(0.3 * level, at + 0.002);
    handEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
    hand.connect(lp).connect(handEnv).connect(out);
    hand.start(at);
    hand.stop(at + 0.06);
  }

  // A single strike, done inside ~150ms.
  function tap(kind, lane) {
    var c = ctx();
    if (c.state !== 'running') return;
    strike(c, hitBus(), c.currentTime,
           LANE_JINGLE_HZ[lane] || 3700,
           kind === 'perfect' ? 1 : kind === 'great' ? 0.85 : 0.68,
           0.13);
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
  // No sound runs while a hold is being kept: a sustained tone sat badly against
  // the music and fought the tambourine hits landing on top of it. The tail's own
  // shrinking bar is the feedback; only completing it makes a sound.

  // Carrying a hold to its end is answered with the same tambourine as a tap, on
  // the same lane band — shaken rather than struck once. Two strikes a beat apart
  // with a longer tail read as a finish without becoming a different instrument;
  // a pitched sweep here sounded like a toy next to the tambourine taps.
  function holdComplete(lane) {
    var c = ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime, out = hitBus();
    var base = LANE_JINGLE_HZ[lane] || 3700;
    strike(c, out, now, base, 0.9, 0.1);
    strike(c, out, now + 0.055, base, 1, 0.26);
  }

  RG.audio = {
    ctx: ctx, tap: tap, tapMiss: tapMiss,
    holdComplete: holdComplete
  };
})();
