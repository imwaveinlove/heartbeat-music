/* audio.js — the two sounds v2 adds on top of ../js/audio.js.
 *
 * Loaded after it and extends the same RG.audio object, sharing its context, its
 * compressor bus and its noise buffer. A separate chain here would bypass that
 * compressor and stack gain against the music, which is the exact problem the
 * shared bus exists to solve.
 *
 * A slash has to sound like the same instrument as a tap or the two note kinds
 * stop feeling like one game — so it is the tambourine again, shaken sideways:
 * a swept band of noise with the strike landing at the end of the sweep.
 */
(function () {
  'use strict';

  var A = RG.audio;

  function slash(kind, col) {
    var c = A.ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime, out = A.hitBus();
    var base = A.LANE_JINGLE_HZ[col] || 3700;
    var level = kind === 'perfect' ? 1 : kind === 'great' ? 0.85 : 0.68;

    // The sweep: the sound of the shake travelling, ahead of the discs landing.
    var air = A.noise();
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(base * 0.45, now);
    bp.frequency.exponentialRampToValueAtTime(base * 1.7, now + 0.085);
    var env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.42 * level, now + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    air.connect(bp).connect(env).connect(out);
    air.start(now);
    air.stop(now + 0.18);

    // ...and the discs, landing where the finger leaves the note.
    A.strike(c, out, now + 0.055, base, level * 0.9, 0.17);
  }

  // Deliberately the ugliest sound in the game: a detuned low pair through a
  // shaped noise burst. It has to be unmistakable at a glance-free moment, when
  // the player is looking at the next note rather than at what they just hit.
  function bomb() {
    var c = A.ctx();
    if (c.state !== 'running') return;
    var now = c.currentTime, out = A.hitBus();

    for (var i = 0; i < 2; i++) {
      var osc = c.createOscillator();
      var env = c.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(110 + i * 7, now);
      osc.frequency.exponentialRampToValueAtTime(38 + i * 4, now + 0.28);
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(0.22, now + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      osc.connect(env).connect(out);
      osc.start(now);
      osc.stop(now + 0.34);
    }

    var burst = A.noise();
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, now);
    lp.frequency.exponentialRampToValueAtTime(300, now + 0.22);
    var nEnv = c.createGain();
    nEnv.gain.setValueAtTime(0.0001, now);
    nEnv.gain.exponentialRampToValueAtTime(0.34, now + 0.004);
    nEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    burst.connect(lp).connect(nEnv).connect(out);
    burst.start(now);
    burst.stop(now + 0.28);
  }

  A.slash = slash;
  A.bomb = bomb;
})();
