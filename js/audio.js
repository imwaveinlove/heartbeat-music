/* audio.js — the shared AudioContext and the built-in demo beat.
 *
 * The demo exists so the game is playable before the user picks a file, and it
 * runs through the exact same analysis path as a real song.
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

  function makeDemoSong() {
    var sr = 44100, dur = 32, bpm = 124, beat = 60 / bpm;
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var off = new OC(1, Math.ceil(sr * dur), sr);

    var noiseBuf = off.createBuffer(1, sr, sr);
    var nd = noiseBuf.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    function env(node, t, peak, decay) {
      var g = off.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      node.connect(g);
      return g;
    }
    function kick(t) {
      var o = off.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      env(o, t, 0.9, 0.28).connect(off.destination);
      o.start(t); o.stop(t + 0.3);
    }
    function snare(t) {
      var s = off.createBufferSource(); s.buffer = noiseBuf;
      var bp = off.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
      s.connect(bp);
      env(bp, t, 0.5, 0.18).connect(off.destination);
      s.start(t); s.stop(t + 0.2);
    }
    function hat(t) {
      var s = off.createBufferSource(); s.buffer = noiseBuf;
      var hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      s.connect(hp);
      env(hp, t, 0.22, 0.05).connect(off.destination);
      s.start(t); s.stop(t + 0.07);
    }
    function blip(t, f) {
      var o = off.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      env(o, t, 0.3, 0.22).connect(off.destination);
      o.start(t); o.stop(t + 0.25);
    }

    var scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    var totalBeats = Math.floor(dur / beat);
    for (var b = 0; b < totalBeats; b++) {
      var t = 1.0 + b * beat;
      var inBar = b % 4;
      if (inBar === 0 || inBar === 2) kick(t);
      if (inBar === 1 || inBar === 3) snare(t);
      hat(t); hat(t + beat / 2);
      if (b > 7 && b % 2 === 0) blip(t, scale[(b * 3) % scale.length]);
      if (b > 15 && inBar === 3) blip(t + beat / 2, scale[(b * 5) % scale.length]);
    }
    return off.startRendering();
  }

  RG.audio = { ctx: ctx, makeDemoSong: makeDemoSong };
})();
