/**
 * Voice input on top of the Web Speech API. Chrome, Edge, Samsung Internet and
 * Safari support it; elsewhere `supported` is false and callers hide the mic
 * (typing into the same box still goes through the same assistant).
 */
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = Boolean(Recognition);

let active = null;

/**
 * listen({ onInterim, onResult, onEnd, onError, lang })
 * Returns a stop() function. Only one recogniser runs at a time.
 */
export function listen({ onInterim, onResult, onEnd, onError, lang = 'en-IN' } = {}) {
  if (!Recognition) { onError?.(new Error('Voice input is not supported in this browser. Try Chrome or Safari.')); return () => {}; }
  active?.abort();
  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t; else interim += t;
    }
    if (interim) onInterim?.(finalText + interim);
  };
  rec.onerror = (e) => {
    const msg = e.error === 'not-allowed' ? 'Microphone access is blocked. Allow it in your browser settings.'
      : e.error === 'no-speech' ? 'I did not hear anything. Tap the mic and try again.'
        : e.error === 'network' ? 'Voice recognition needs an internet connection.' : `Voice input stopped (${e.error}).`;
    if (e.error !== 'aborted') onError?.(new Error(msg));
  };
  rec.onend = () => {
    active = null;
    if (finalText.trim()) onResult?.(finalText.trim());
    onEnd?.();
  };
  rec.start();
  active = rec;
  return () => rec.stop();
}

/** Reads a reply aloud, if the member has not turned that off. */
export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  try { if (localStorage.getItem('subtize.voiceReplies') === 'off') return; } catch { /* storage blocked: default to speaking */ }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/₹/g, 'rupees '));
    u.lang = 'en-IN';
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch { /* speaking is a nicety */ }
}

/**
 * Wires a mic button to an input: tap to talk, the transcript lands in the
 * input, then `onFinal(text)` runs (usually the assistant call).
 */
export function attachMic(button, input, onFinal, { status = null } = {}) {
  if (!button) return;
  if (!voiceSupported) { button.hidden = true; return; }
  let stop = null;
  const setStatus = (t) => { if (status) { status.hidden = !t; status.querySelector('[data-text]').textContent = t || ''; } };
  button.addEventListener('click', () => {
    if (stop) { stop(); return; }
    button.classList.add('listening');
    button.setAttribute('aria-pressed', 'true');
    setStatus('Listening…');
    stop = listen({
      onInterim: (t) => { input.value = t; setStatus(t); },
      onResult: (t) => { input.value = t; onFinal(t); },
      onError: (e) => { setStatus(''); import('./ui.js').then(({ toast }) => toast(e.message, 'bad')); },
      onEnd: () => { stop = null; button.classList.remove('listening'); button.setAttribute('aria-pressed', 'false'); setStatus(''); },
    });
  });
}
