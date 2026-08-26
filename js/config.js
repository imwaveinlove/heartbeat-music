/* config.js — tuning constants and the shared namespace.
 *
 * Loaded first. Every other file hangs its module off window.RG.
 * Plain <script> files (not ES modules) so the game runs from file:// with no server.
 */
window.RG = window.RG || {};

RG.config = {
  LANES: 4,
  KEYS: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  KEY_LABELS: ['D', 'F', 'J', 'K'],
  // pink · lavender · mint · sky — saturated enough to read on the pale field
  LANE_COLORS: ['#ff2e88', '#b57bee', '#2fc9b8', '#5f9cff'],

  // Judgement windows in seconds either side of the note's exact time.
  WINDOWS: { perfect: 0.045, great: 0.090, good: 0.145, miss: 0.190 },
  SCORES:  { perfect: 300, great: 200, good: 100 },

  ANALYSIS_RATE: 22050,   // offline render rate for onset analysis
  HOP: 256,               // samples per analysis frame (~11.6ms at 22050)
  LEAD_IN: 2.2,           // seconds of empty runway before audio starts
  BASE_APPROACH: 1.7,     // seconds for a note to travel the lane at 1.0x

  // nps = target notes per second; the gaps keep a chart physically playable.
  DIFFS: {
    easy:   { nps: 2.4, laneGap: 0.26, globalGap: 0.13 },
    normal: { nps: 4.0, laneGap: 0.17, globalGap: 0.085 },
    hard:   { nps: 6.2, laneGap: 0.11, globalGap: 0.055 }
  },

  // One filter per lane: kick / low-mid / high-mid / hats+cymbals.
  BAND_DEFS: [
    { type: 'lowpass',  freq: 130,  q: 0.9 },
    { type: 'bandpass', freq: 320,  q: 1.1 },
    { type: 'bandpass', freq: 1400, q: 1.1 },
    { type: 'highpass', freq: 3800, q: 0.9 }
  ]
};

// Player-adjustable settings, shared across modules.
RG.settings = { diff: 'normal', speed: 1.0, offset: 0 };

// The loaded song and its generated chart.
RG.song = { buffer: null, label: '', chart: null };

// Transient visual state, written by game.js and read by render.js.
RG.fx = {
  laneFlash: [0, 0, 0, 0],
  keyHeld: [false, false, false, false],
  hits: [],
  judge: null
};
