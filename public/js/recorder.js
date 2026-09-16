/**
 * Browser microphone recorder for interview answers.
 *
 * Handles the awkward bits: picking a mime type the browser will actually
 * produce, keeping a live level meter, enforcing the per-question time limit,
 * and releasing the mic afterwards so the tab stops showing a recording dot.
 */

const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/aac',
];

export const recordingSupported = () =>
  Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

export function pickMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  return CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export function micErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow the mic for this site in your browser settings, then reload.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone found. Plug one in or pick a different input device.';
    case 'NotReadableError':
      return 'Your microphone is busy in another app. Close it and try again.';
    default:
      return err?.message || 'Could not start recording.';
  }
}

export class AnswerRecorder extends EventTarget {
  /** @param {{maxSeconds:number, onTick?:Function, onLevel?:Function}} opts */
  constructor({ maxSeconds = 120 } = {}) {
    super();
    this.maxSeconds = maxSeconds;
    this.state = 'idle'; // idle | armed | recording | stopping | done
    this.elapsed = 0;
    this.blob = null;
    this.mimeType = '';
    this._chunks = [];
  }

  emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }

  /** Requests mic access up front so the permission prompt is not a surprise mid-question. */
  async arm() {
    if (!recordingSupported()) {
      throw new Error('This browser cannot record audio. Try a recent Chrome, Edge, Firefox or Safari.');
    }
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this._startMeter();
    this.state = 'armed';
    this.emit('armed');
    return this;
  }

  _startMeter() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this._audioCtx = new Ctx();
      const source = this._audioCtx.createMediaStreamSource(this._stream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 256;
      source.connect(this._analyser);
      this._levelData = new Uint8Array(this._analyser.frequencyBinCount);

      const loop = () => {
        if (!this._analyser) return;
        this._analyser.getByteFrequencyData(this._levelData);
        let sum = 0;
        for (const v of this._levelData) sum += v;
        this.emit('level', { level: Math.min(1, sum / this._levelData.length / 110) });
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    } catch {
      /* the meter is decoration — recording still works without it */
    }
  }

  start() {
    if (this.state !== 'armed') throw new Error('Recorder is not ready yet.');
    this.mimeType = pickMimeType();
    this._chunks = [];
    this._recorder = new MediaRecorder(this._stream, this.mimeType ? { mimeType: this.mimeType } : undefined);

    this._recorder.ondataavailable = (e) => { if (e.data?.size) this._chunks.push(e.data); };
    this._recorder.onerror = (e) => this.emit('error', { error: e.error || new Error('Recording failed.') });
    this._recorder.onstop = () => {
      const type = this._recorder.mimeType || this.mimeType || 'audio/webm';
      this.blob = new Blob(this._chunks, { type: type.split(';')[0] });
      this.state = 'done';
      this.release();
      this.emit('complete', { blob: this.blob, seconds: this.elapsed, mimeType: this.blob.type });
    };

    this._recorder.start(250);
    this.state = 'recording';
    this.elapsed = 0;
    this._startedAt = Date.now();
    this._timer = setInterval(() => {
      this.elapsed = (Date.now() - this._startedAt) / 1000;
      this.emit('tick', { elapsed: this.elapsed, remaining: Math.max(0, this.maxSeconds - this.elapsed) });
      if (this.elapsed >= this.maxSeconds) {
        this.emit('limit');
        this.stop();
      }
    }, 200);
    this.emit('started');
  }

  stop() {
    if (this.state !== 'recording') return;
    this.state = 'stopping';
    clearInterval(this._timer);
    this.elapsed = (Date.now() - this._startedAt) / 1000;
    try { this._recorder.stop(); } catch { this.release(); }
  }

  /** Stops the mic and tears down the meter. Safe to call more than once. */
  release() {
    clearInterval(this._timer);
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._analyser = null;
    this._audioCtx?.close?.().catch(() => {});
    this._audioCtx = null;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
  }

  discard() {
    this.blob = null;
    this.state = this._stream ? 'armed' : 'idle';
  }

  /** Filename the server can infer an extension from. */
  filename() {
    const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3' };
    return `answer.${ext[this.blob?.type] || 'webm'}`;
  }
}

/**
 * Countdown for the "think about it" phase. Returns the promise plus a cancel
 * handle, because the candidate can skip ahead at any point.
 */
export function countdown(seconds, onTick) {
  let left = seconds;
  let timer = null;
  onTick(left);

  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  const finish = (skipped) => { clearInterval(timer); timer = null; settle(skipped); };

  timer = setInterval(() => {
    left -= 1;
    onTick(Math.max(0, left));
    if (left <= 0) finish(false);
  }, 1000);

  return { promise, cancel: () => finish(true) };
}
