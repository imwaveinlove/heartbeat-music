/* dom.js — one lookup of every element the game touches. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv');

  RG.el = {
    cv: cv,
    ctx: cv.getContext('2d'),
    logo: $('logo'), logoCat: $('logoCat'),

    // HUD
    vScore: $('vScore'), vCombo: $('vCombo'), vAcc: $('vAcc'),
    progressFill: $('progressFill'), pauseBtn: $('pauseBtn'),

    // Overlays
    menuOverlay: $('menuOverlay'), pauseOverlay: $('pauseOverlay'), resultOverlay: $('resultOverlay'),

    // Song loading
    songRow: $('songRow'),
    pickFileBtn: $('pickFileBtn'), fileInput: $('fileInput'),
    captureBtn: $('captureBtn'), capturePanel: $('capturePanel'),
    captureTime: $('captureTime'), captureStopBtn: $('captureStopBtn'),
    fileName: $('fileName'), loadStatus: $('loadStatus'), bar: $('bar'), barFill: $('barFill'),

    // Settings
    diffSeg: $('diffSeg'), inputSeg: $('inputSeg'),
    speedRange: $('speedRange'), speedVal: $('speedVal'),
    offsetRange: $('offsetRange'), offsetVal: $('offsetVal'),

    // Buttons
    playBtn: $('playBtn'), fsBtn: $('fsBtn'),
    resumeBtn: $('resumeBtn'), quitBtn: $('quitBtn'),
    againBtn: $('againBtn'), menuBtn: $('menuBtn'),

    // Result
    grade: $('grade'), rScore: $('rScore'), rAcc: $('rAcc'), rBest: $('rBest'),
    sP: $('sP').querySelector('b'), sG: $('sG').querySelector('b'),
    sO: $('sO').querySelector('b'), sM: $('sM').querySelector('b')
  };
})();
