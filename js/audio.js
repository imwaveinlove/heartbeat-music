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

  // One shared bus for every hit sound. Without it, a dense stream of notes stacks
  // gain and clips against the song; the compressor keeps the mix from spiking.
  var bus = null;
  function hitBus() {
    var c = ctx();
    if (!bus) {
      var comp = c.createDynamicsCompressor();
      var g = c.createGain();
      g.gain.value = 0.55;
      g.connect(comp).connect(c.destination);
      bus = g;
    }
    return bus;
  }

  // A pentatonic set, so notes landing together never sound dissonant.
  var LANE_HZ = [523.25, 659.25, 783.99, 987.77];   // C5 E5 G5 B5

  function tap(kind, lane) {
    var c = ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime;
    var out = hitBus();

    // Soft pluck: triangle body, quick exponential decay.
    var osc = c.createOscillator();
    var env = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(LANE_HZ[lane] || 523.25, now);
    var peak = kind === 'perfect' ? 0.32 : kind === 'great' ? 0.26 : 0.2;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(env).connect(out);
    osc.start(now);
    osc.stop(now + 0.15);

    // A short high blip on top gives the press its "click" transient.
    var tick = c.createOscillator();
    var tickEnv = c.createGain();
    tick.type = 'square';
    tick.frequency.setValueAtTime((LANE_HZ[lane] || 523.25) * 3, now);
    tickEnv.gain.setValueAtTime(0.0001, now);
    tickEnv.gain.exponentialRampToValueAtTime(0.05, now + 0.002);
    tickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    tick.connect(tickEnv).connect(out);
    tick.start(now);
    tick.stop(now + 0.05);
  }

  function tapMiss() {
    var c = ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime;
    var osc = c.createOscillator();
    var env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.12, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(env).connect(hitBus());
    osc.start(now);
    osc.stop(now + 0.18);
  }

  RG.audio = { ctx: ctx, tap: tap, tapMiss: tapMiss };
})();
