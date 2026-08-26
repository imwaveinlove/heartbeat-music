/* capture.js — record audio playing in another tab and chart that.
 *
 * A YouTube or SoundCloud link cannot be charted directly: their media is
 * cross-origin, so fetch() is blocked, and an embedded player's audio sits
 * inside a cross-origin iframe where Web Audio cannot reach it. What a browser
 * *can* do is capture audio already playing on this machine — that is what
 * getDisplayMedia gives us once the viewer ticks "share tab audio".
 *
 * The recording is captured to a Blob, decoded to an AudioBuffer, and then goes
 * through exactly the same analysis path as a picked file.
 */
(function () {
  'use strict';

  var MAX_SECONDS = 10 * 60;   // runaway guard; a chart this long is unplayable anyway

  var stream = null;
  var recorder = null;
  var chunks = [];
  var startedAt = 0;
  var tickTimer = null;
  var handlers = {};
  var finishing = false;

  function supported() {
    return !!(navigator.mediaDevices &&
              navigator.mediaDevices.getDisplayMedia &&
              window.MediaRecorder);
  }

  // Chrome and Firefox record WebM/Opus; Safari has no tab-audio capture at all,
  // so an empty result here simply means the browser cannot do this.
  function pickMimeType() {
    var candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';   // let the browser choose
  }

  function cleanup() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) {
        try { t.stop(); } catch (e) {}
      });
      stream = null;
    }
    recorder = null;
  }

  function fail(msg) {
    cleanup();
    chunks = [];
    finishing = false;
    if (handlers.onError) handlers.onError(msg);
  }

  function elapsed() { return (Date.now() - startedAt) / 1000; }

  function start(cbs) {
    handlers = cbs || {};
    if (!supported()) {
      return fail('이 브라우저는 탭 오디오 캡처를 지원하지 않습니다. 크롬이나 엣지에서 열어 주세요.');
    }
    finishing = false;
    chunks = [];

    // video:true is not optional — Chrome refuses an audio-only getDisplayMedia
    // request. The video track is stopped as soon as the stream arrives.
    navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (s) {
      stream = s;

      var audioTracks = s.getAudioTracks();
      if (!audioTracks.length) {
        return fail('소리가 공유되지 않았습니다. 공유 창에서 탭을 고르고 "탭 오디오도 공유" 를 체크해 주세요.');
      }

      s.getVideoTracks().forEach(function (t) {
        try { t.stop(); } catch (e) {}   // frames are not needed, only the audio
      });

      var audioOnly = new MediaStream(audioTracks);
      var mime = pickMimeType();
      try {
        recorder = mime ? new MediaRecorder(audioOnly, { mimeType: mime })
                        : new MediaRecorder(audioOnly);
      } catch (e) {
        return fail('녹음을 시작하지 못했습니다: ' + e.message);
      }

      recorder.ondataavailable = function (e) {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      recorder.onstop = finish;

      // If the viewer ends sharing from the browser's own bar, wrap up cleanly.
      audioTracks[0].addEventListener('ended', function () { stop(); });

      startedAt = Date.now();
      recorder.start(1000);   // flush a chunk each second so nothing is lost on stop

      tickTimer = setInterval(function () {
        var t = elapsed();
        if (handlers.onTick) handlers.onTick(t);
        if (t >= MAX_SECONDS) stop();
      }, 250);

      if (handlers.onStart) handlers.onStart();
    }).catch(function (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        return fail('화면 공유가 취소되었습니다.');
      }
      fail('캡처를 시작하지 못했습니다: ' + ((err && err.message) || err));
    });
  }

  function stop() {
    if (!recorder || finishing) return;
    finishing = true;
    if (recorder.state !== 'inactive') {
      try { recorder.stop(); return; } catch (e) {}
    }
    finish();
  }

  function finish() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    var seconds = elapsed();
    var blob = new Blob(chunks, { type: chunks.length ? chunks[0].type : 'audio/webm' });
    chunks = [];
    cleanup();

    if (!blob.size) {
      finishing = false;
      if (handlers.onError) handlers.onError('녹음된 소리가 없습니다. 탭 오디오 공유를 체크했는지 확인해 주세요.');
      return;
    }
    if (seconds < 3) {
      finishing = false;
      if (handlers.onError) handlers.onError('녹음이 너무 짧습니다. 곡을 재생한 채로 조금 더 길게 녹음해 주세요.');
      return;
    }

    blob.arrayBuffer()
      .then(function (ab) { return RG.audio.ctx().decodeAudioData(ab); })
      .then(function (buffer) {
        finishing = false;
        if (handlers.onDone) handlers.onDone(buffer);
      })
      .catch(function (err) {
        finishing = false;
        if (handlers.onError) {
          handlers.onError('녹음을 디코딩하지 못했습니다: ' + ((err && err.message) || err));
        }
      });
  }

  function isRecording() { return !!recorder && !finishing; }

  RG.capture = { supported: supported, start: start, stop: stop, isRecording: isRecording };
})();
