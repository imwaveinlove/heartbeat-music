/* config.js — v2 tuning constants and the shared namespace.
 *
 * v2 keeps v1's band-analysis chart engine but changes the instrument: instead of
 * four keys under four fingers, notes fly out of a vanishing point toward the
 * player and are played by touching and dragging on the glass.
 *
 * The namespace is still window.RG, so the shared js/audio.js, js/capture.js
 * and js/icon.js load unchanged. Everything under js/v2 replaces its v1 twin.
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

  // Note kinds. There is no tap: every note that is played is a slash, and the
  // other two are the exceptions to it.
  //
  // Dropping the tap is what made the game readable. With both kinds on screen a
  // player has to classify each arriving note before choosing what to do with it,
  // and a misread is a miss — while the arrow, which says what to do, is a
  // clearer glyph at distance than "heart or cube" ever was.
  SLASH: 0, HOLD: 1, BOMB: 2,

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

  // A drag counts as a slash once the finger has covered ground in one direction.
  //
  // Measured from an anchor that only moves when the finger turns, NOT inside a
  // fixed time window. A trailing window looks like the right way to reject a
  // finger drifting across the glass, but it also rejects a deliberate slow
  // flick: at 55ms per sample the travel inside the window never reaches the
  // threshold and the note simply cannot be hit, however well it is aimed.
  // Turning is what separates a flick from wandering, not speed.
  // minDist is deliberately small. It only has to be enough to know which way the
  // finger is going — waiting for a long travel means judging the flick late, and
  // the direction is already unambiguous well before then.
  SWIPE: {
    minDist: 0.16,    // fraction of a cell the finger must cover, at any speed
    angleTol: 70,     // degrees off the arrow that still counts
    maxAge: 0.28      // how far back a flick may be traced, in seconds
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
  BASE_APPROACH: 1.85,   // seconds for a note to fly the corridor at 1.0x

  // Two pointers or one. On a phone the left thumb owns columns 0-1 and the right
  // owns 2-3, so a note is only reachable if that thumb is not still busy next
  // door. A mouse is a single pointer that has to reach the whole grid, so it gets
  // fewer notes and a wider global gap instead.
  // Both numbers went up when the taps went away: every note is now a gesture,
  // and a thumb that has to flick cannot be asked to do it as often as a thumb
  // that only had to land.
  INPUT: {
    touch: { npsScale: 1.0, handGap: 0.24, gapFloor: 0 },
    mouse: { npsScale: 0.7, handGap: 0,    gapFloor: 0.28 }
  },

  // The ladder adds a note kind at a time, so each level is a thing to learn
  // rather than the same chart played faster:
  //   EASY   slash, up and down only
  //   NORMAL + left and right, + hold
  //   HARD   + bomb, tighter, overlapping holds
  //
  // EASY keeps two directions because the glyph is the thing being learned there.
  // From NORMAL the horizontal arrows earn their place by pointing at the next
  // note (see flowDirections) — they stop being extra information to decode and
  // become the choreography.
  //
  // nps is lower across the board than it was when taps existed. Every note now
  // costs a gesture, so notes-per-second and flicks-per-second are the same
  // number, and the old 4.4 was asking for a flick every 227ms.
  DIFFS: {
    easy:   { nps: 1.2, cellGap: 0.50, globalGap: 0.38, dirSet: 'ud',
              holdShare: 0,    holdMax: 0,   soloHold: true,  bombShare: 0 },
    normal: { nps: 2.0, cellGap: 0.34, globalGap: 0.24, dirSet: 'cardinal4',
              holdShare: 0.10, holdMax: 1.6, soloHold: true,  bombShare: 0 },
    hard:   { nps: 3.0, cellGap: 0.22, globalGap: 0.15, dirSet: 'cardinal4',
              holdShare: 0.14, holdMax: 2.6, soloHold: false, bombShare: 0.04 }
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
  shake: 0,           // set on a bomb, decays in render
  comboPop: 0,        // last combo increment — the mascots bounce off this
  comboMilestone: 0   // last multiple of ten — they throw hearts off this
};
