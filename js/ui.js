/* ui.js — menu wiring: loading a song, settings, fullscreen, overlay buttons. */
(function () {
  'use strict';

  var el = RG.el;

  function setStatus(msg) { el.loadStatus.textContent = msg || ''; }
  function setBar(p) {
    el.bar.classList.toggle('hidden', p == null);
    if (p != null) el.barFill.style.width = Math.round(p * 100) + '%';
  }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Analysis is async and re-runs on every difficulty change. The token makes a
  // newer request win, so a slow earlier one cannot overwrite the current chart.
  var analysisToken = 0;

  function prepare(buffer, label) {
    var token = ++analysisToken;
    RG.song.buffer = buffer;
    RG.song.label = label;
    RG.song.chart = null;

    el.fileName.textContent = label;
    el.playBtn.classList.add('hidden');
    setStatus('채보 분석 중...');
    setBar(0);

    return RG.chart.build(buffer, RG.settings.diff, function (p) {
      if (token === analysisToken) setBar(p);
    })
      .then(function (notes) {
        if (token !== analysisToken) return;
        RG.song.chart = notes;
        setBar(null);
        if (!notes.length) {
          setStatus('노트를 찾지 못했습니다. 다른 음원을 시도해 주세요.');
          return;
        }
        setStatus('노트 ' + notes.length + '개 · 길이 ' + fmtTime(buffer.duration));
        el.playBtn.classList.remove('hidden');
      })
      .catch(function (err) {
        if (token !== analysisToken) return;
        setBar(null);
        setStatus('분석 실패: ' + err.message);
      });
  }

  // ---------- built-in tracks ----------
  RG.songs.builtin.forEach(function (track) {
    var b = document.createElement('button');
    b.className = 'btn ghost song-btn';
    b.innerHTML = '<span>' + track.title + '</span><small>' + track.note + '</small>';
    b.addEventListener('click', function () {
      RG.audio.ctx();                        // unlock audio inside the tap
      setStatus('수록곡 불러오는 중...');
      setBar(null);
      el.playBtn.classList.add('hidden');
      // Yield to the event loop so the status paints before base64 decoding blocks
      // the thread. setTimeout, not rAF: rAF never fires while the tab is hidden.
      setTimeout(function () {
        RG.songs.load(track)
          .then(function (buf) { return prepare(buf, track.title + ' ' + track.note); })
          .catch(function (err) { setStatus(err.message); });
      }, 0);
    });
    el.songRow.appendChild(b);
  });

  // ---------- song sources ----------
  el.pickFileBtn.addEventListener('click', function () {
    RG.audio.ctx();          // unlock audio inside the tap
    el.fileInput.click();
  });

  el.fileInput.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setStatus('음원 디코딩 중...');
    setBar(null);
    el.playBtn.classList.add('hidden');
    file.arrayBuffer()
      .then(function (ab) { return RG.audio.ctx().decodeAudioData(ab); })
      .then(function (buf) { return prepare(buf, file.name); })
      .catch(function (err) {
        setStatus('불러오기 실패: ' + err.message + ' (mp3/wav/ogg 를 시도해 보세요)');
      });
  });

  // ---------- tab audio capture ----------
  // Only offered where the browser can actually do it; Safari cannot capture
  // tab audio at all, so the button stays hidden there rather than failing later.
  if (RG.capture.supported()) el.captureBtn.classList.remove('hidden');

  function showCapturePanel(on) {
    el.capturePanel.classList.toggle('hidden', !on);
    el.captureBtn.classList.toggle('hidden', on || !RG.capture.supported());
    el.pickFileBtn.disabled = on;
  }

  el.captureBtn.addEventListener('click', function () {
    RG.audio.ctx();
    el.playBtn.classList.add('hidden');
    setStatus('공유 창에서 곡이 재생 중인 탭을 고르고 "탭 오디오도 공유" 를 체크해 주세요.');
    RG.capture.start({
      onStart: function () {
        showCapturePanel(true);
        el.captureTime.textContent = '0:00';
        setStatus('녹음 중... 곡을 처음부터 재생해 주세요.');
      },
      onTick: function (sec) { el.captureTime.textContent = fmtTime(sec); },
      onDone: function (buffer) {
        showCapturePanel(false);
        prepare(buffer, '탭 녹음 ' + fmtTime(buffer.duration));
      },
      onError: function (msg) {
        showCapturePanel(false);
        setStatus(msg);
      }
    });
  });

  el.captureStopBtn.addEventListener('click', function () {
    setStatus('녹음을 마무리하는 중...');
    RG.capture.stop();
  });

  // ---------- settings ----------
  el.diffSeg.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    RG.settings.diff = b.dataset.diff;
    Array.prototype.forEach.call(el.diffSeg.children, function (c) {
      c.classList.toggle('on', c === b);
    });
    if (RG.song.buffer) prepare(RG.song.buffer, RG.song.label);   // re-chart
  });

  el.speedRange.addEventListener('input', function () {
    RG.settings.speed = parseFloat(el.speedRange.value);
    el.speedVal.textContent = RG.settings.speed.toFixed(1) + 'x';
  });
  el.offsetRange.addEventListener('input', function () {
    RG.settings.offset = parseInt(el.offsetRange.value, 10);
    el.offsetVal.textContent = RG.settings.offset + ' ms';
  });

  // ---------- overlay buttons ----------
  el.playBtn.addEventListener('click', function () { RG.game.start(); });
  el.againBtn.addEventListener('click', function () { RG.game.start(); });
  el.menuBtn.addEventListener('click', function () { RG.game.toMenu(); });
  el.quitBtn.addEventListener('click', function () { RG.game.toMenu(); });
  el.resumeBtn.addEventListener('click', function () { RG.game.resume(); });
  el.pauseBtn.addEventListener('click', function () { RG.game.togglePause(); });

  // ---------- fullscreen (mobile browser chrome eats the lane) ----------
  var docEl = document.documentElement;
  if (docEl.requestFullscreen || docEl.webkitRequestFullscreen) {
    el.fsBtn.classList.remove('hidden');
  }
  function fsActive() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function updateFsLabel() { el.fsBtn.textContent = fsActive() ? '⛶ 전체화면 해제' : '⛶ 전체화면'; }

  el.fsBtn.addEventListener('click', function () {
    try {
      if (fsActive()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (docEl.requestFullscreen || docEl.webkitRequestFullscreen).call(docEl);
    } catch (e) { /* some mobile browsers refuse; the game still plays windowed */ }
  });
  function onFsChange() { updateFsLabel(); setTimeout(RG.render.resize, 120); }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // Leaving the tab mid-song would desync audio against the clock — pause instead.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) RG.game.pause();
  });

  RG.ui = { prepare: prepare, setStatus: setStatus };
})();
