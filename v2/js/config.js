/* config.js — v2 tuning constants and the shared namespace.
 *
 * v2 keeps v1's band-analysis chart engine but changes the instrument: instead of
 * four keys under four fingers, notes fly out of a vanishing point toward the
 * player and are played by touching and dragging on the glass.
 *
 * The namespace is still window.RG, so ../js/audio.js, ../js/capture.js and
 * ../js/icon.js load unchanged. Everything under v2/js replaces its v1 twin.
 */
window.RG = window.RG || {};
RG.V2 = true;

RG.config = {
  // The grid the notes arrive on. Columns are frequency bands, exactly as in v1.
  //
  // One row, always. A second row made the game about reaching rather than about
  // rhythm: four targets is what two thumbs cover without the hands leaving the
  // glass, and every note kind stays reachable from where the thumb already is.
  // The difficulty ladder is note kinds instead — see DIFFS.
  COLS: 4,
  ROWS: 1,
  // pink · lavender · mint · sky — the v1 lane palette, one colour per band
  COL_COLORS: ['#ff2e88', '#b57bee', '#2fc9b8', '#5f9cff'],

  // Note kinds. TAP and HOLD are v1's notes moved onto a grid; SLASH is the new
  // one and is what makes this a v2 rather than a reskin.
  TAP: 0, SLASH: 1, HOLD: 2, BOMB: 3,

  // Screen-space unit vectors, plus the rotation that aims an up-pointing arrow
  // along them. ang = atan2(dx, -dy): up is 0, and canvas rotation is clockwise
  // with y down, so right lands at +90°.
  DIRS: (function () {
    var names = ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'];
    var out = [];
    for (var i = 0; i < 8; i++) {
      var a = (i * Math.PI) / 4;           // 0 = up, going clockwise
      var dx = Math.sin(a), dy = -Math.cos(a);
      out.push({ name: names[i], dx: dx, dy: dy, ang: a });
    }
    return out;
  })(),
  DIR_UP: 0, DIR_RIGHT: 2, DIR_DOWN: 4, DIR_LEFT: 6,

  // Judgement windows in seconds either side of the note's exact time. Wider than
  // v1's: pressing a key you are already resting on is not the same act as landing
  // a finger on a target you had to travel to, and the v1 windows felt punishing.
  WINDOWS: { perfect: 0.058, great: 0.110, good: 0.165, miss: 0.215 },
  SCORES:  { perfect: 300, great: 200, good: 100 },

  // A drag only counts as a slash once the finger has actually covered ground.
  // Measured over a short trailing window, not since pointerdown: a finger that
  // wanders slowly across the glass must not read as a flick.
  SWIPE: {
    window: 0.13,     // seconds of pointer history a slash vector is measured over
    minDist: 0.30,    // fraction of a cell the finger must cover inside that window
    angleTol: 58      // degrees off the arrow that still counts
  },

  // How close a touch must land, as a fraction of a cell, to claim a note.
  // Generous on purpose — the note's own cell is the target, and missing by a
  // hair sideways should never read as a miss when the timing was right.
  TOUCH_RADIUS: 0.86,

  HOLD: {
    MIN: 0.34,           // shorter than this plays as a tap, not a hold
    MEASURE_MAX: 2.6,
    RELEASE_GRACE: 0.13,
    BONUS: 220
  },
  // Touching a bomb costs the combo and a little score. It is never a "miss" for
  // accuracy: a bomb is something to avoid, not something you were asked to hit.
  BOMB_PENALTY: 150,

  ANALYSIS_RATE: 22050,
  HOP: 256,
  LEAD_IN: 2.4,          // a touch longer than v1: the runway is also the tutorial
  BASE_APPROACH: 1.6,    // seconds for a note to fly the corridor at 1.0x

  // Two pointers or one. On a phone the left thumb owns columns 0-1 and the right
  // owns 2-3, so a note is only reachable if that thumb is not still busy next
  // door. A mouse is a single pointer that has to reach the whole grid, so it gets
  // fewer notes and a wider global gap instead.
  INPUT: {
    touch: { npsScale: 1.0,  handGap: 0.15, gapFloor: 0 },
    mouse: { npsScale: 0.62, handGap: 0,    gapFloor: 0.19 }
  },

  // The ladder adds a note kind at a time, so each level is a thing to learn
  // rather than the same chart played faster:
  //   EASY   tap + slash                      — touch, and flick
  //   NORMAL + hold                           — and stay
  //   HARD   + bomb, diagonal slashes, overlapping holds
  //
  // EASY gets slashes from the start on purpose. Held back to NORMAL they arrive
  // together with holds and with twice the density, which is three new things at
  // once; and a tap-only EASY is v1 with a worse input method.
  DIFFS: {
    easy:   { nps: 1.6, cellGap: 0.36, globalGap: 0.22,
              slashShare: 0.22, dirSet: 'cardinal', holdShare: 0,
              holdMax: 0,   soloHold: true,  bombShare: 0 },
    normal: { nps: 2.8, cellGap: 0.24, globalGap: 0.13,
              slashShare: 0.38, dirSet: 'cardinal', holdShare: 0.10,
              holdMax: 1.6, soloHold: true,  bombShare: 0 },
    hard:   { nps: 4.4, cellGap: 0.15, globalGap: 0.08,
              slashShare: 0.55, dirSet: 'all',      holdShare: 0.16,
              holdMax: 2.6, soloHold: false, bombShare: 0.05 }
  },

  // One filter per column: kick / low-mid / high-mid / hats+cymbals.
  BAND_DEFS: [
    { type: 'lowpass',  freq: 130,  q: 0.9 },
    { type: 'bandpass', freq: 320,  q: 1.1 },
    { type: 'bandpass', freq: 1400, q: 1.1 },
    { type: 'highpass', freq: 3800, q: 0.9 }
  ],

  // The corridor. zNear is the hit plane, zFar is where notes are born; the focal
  // length and camera height are derived from the viewport at resize so the grid
  // always lands in the same place on screen (see render.js).
  // zFar decides how much of the flight is legible. Pushed far out the notes
  // spend most of it as specks by the vanishing point and then arrive all at
  // once; at 4.0 a note is readable from the moment it appears, which is what a
  // chart with four different note kinds needs.
  VIEW: { zNear: 1.0, zFar: 4.0, gridHalf: 2.0 }
};

RG.settings = {
  diff: 'normal', speed: 1.0, offset: 0,
  input: (function () {
    try { return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse'; }
    catch (e) { return 'mouse'; }
  })()
};

RG.song = { buffer: null, label: '', chart: null };

// Transient visual state, written by game.js and read by render.js.
RG.fx = {
  cellFlash: [],      // [col][row] -> performance.now() of the last touch (row is always 0)
  hits: [],           // rings blooming at the hit plane
  slashes: [],        // the streak a finger leaves behind
  judge: null,
  shake: 0            // set on a bomb, decays in render
};

// v2/index.html sits one level below songs/, and ../js/songs.js reads this.
RG.songsBase = '../songs/';
