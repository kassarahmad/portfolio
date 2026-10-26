// Voce: microfono con rilevamento delle pause, trascrizione locale, lettura delle risposte.
// L'audio va solo al server di AI Locale sul PC (faster-whisper e Piper), mai a servizi esterni.

export function speakableText(text) {
  return (text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~>#]+/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function chunks(text, max = 260) {
  const parts = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
  const out = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = ""; }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export class VoiceIO {
  constructor({ api, getLang }) {
    this.api = api;
    this.getLang = getLang;
    this.status = { stt: false, tts: false };
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.level = 0;
    this.floor = 0.01;
    this.speaking = false;
    this.audio = null;
    this.cancelSpeak = false;
    this.listeners = new Set();
  }

  async refresh() {
    try { this.status = await this.api("/api/voice/status"); } catch { this.status = { stt: false, tts: false }; }
    return this.status;
  }

  onLevel(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async openMic() {
    if (this.stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const err = new Error("insecure"); err.code = "insecure"; throw err;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { const err = new Error("denied"); err.code = "denied"; throw err; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    const buf = new Float32Array(this.analyser.fftSize);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      this.level = Math.sqrt(sum / buf.length);
      this.listeners.forEach((fn) => fn(this.level));
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  closeMic() {
    cancelAnimationFrame(this._raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.level = 0;
  }

  _recorder() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
    return new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
  }

  /**
   * Registra finché la persona parla e poi si ferma (pausa di `silenceMs`).
   * Restituisce il Blob audio, oppure null se annullato o se non ha parlato.
   */
  listen({ silenceMs = 900, maxMs = 45000, idleMs = 25000, signal, until } = {}) {
    return new Promise((resolve) => {
      const rec = this._recorder();
      const parts = [];
      let started = 0;
      let hadSpeech = false;
      let lastVoice = 0;
      let loud = 0;
      const t0 = performance.now();
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      rec.onstop = () => {
        clearInterval(timer);
        resolve(hadSpeech && !signal?.aborted ? new Blob(parts, { type: rec.mimeType || "audio/webm" }) : null);
      };
      rec.start(250);
      started = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        if (signal?.aborted) { if (rec.state !== "inactive") rec.stop(); return; }
        if (until?.()) { if (now - started > 500) hadSpeech = true; if (rec.state !== "inactive") rec.stop(); return; }
        const thr = Math.max(0.018, this.floor * 3);
        if (this.level > thr) {
          loud += 50;
          if (loud >= 150) { hadSpeech = true; lastVoice = now; }
        } else {
          loud = 0;
          if (!hadSpeech) this.floor = this.floor * 0.95 + this.level * 0.05;
        }
        if (hadSpeech && now - lastVoice > silenceMs) rec.stop();
        else if (now - started > maxMs) rec.stop();
        else if (!hadSpeech && now - t0 > idleMs) rec.stop();
      }, 50);
    });
  }

  async transcribe(blob) {
    const fd = new FormData();
    fd.append("audio", blob, "voce.webm");
    fd.append("language", this.getLang());
    const r = await this.api("/api/voice/transcribe", { method: "POST", body: fd });
    return (r.text || "").trim();
  }

  stopSpeaking() {
    this.cancelSpeak = true;
    if (this.audio) { this.audio.pause(); this.audio = null; }
    window.speechSynthesis?.cancel();
    this.speaking = false;
  }

  _localVoice() {
    const lang = this.getLang();
    const voices = window.speechSynthesis?.getVoices() || [];
    return voices.find((v) => v.lang?.toLowerCase().startsWith(lang) && v.localService)
      || voices.find((v) => v.lang?.toLowerCase().startsWith(lang)) || null;
  }

  /** Legge il testo: voce Piper del server se c'è, altrimenti le voci locali del sistema. */
  async speak(text, { onBargeIn } = {}) {
    const clean = speakableText(text);
    if (!clean) return;
    this.stopSpeaking();
    this.cancelSpeak = false;
    this.speaking = true;
    let stopBarge = null;
    if (onBargeIn && this.stream) {
      let loud = 0;
      stopBarge = this.onLevel((lvl) => {
        loud = lvl > Math.max(0.05, this.floor * 6) ? loud + 1 : 0;
        if (loud > 18 && this.speaking) { this.stopSpeaking(); onBargeIn(); }
      });
    }
    try {
      const list = chunks(clean);
      if (this.status.tts) {
        const fetchWav = (t) => fetch("/api/voice/speak", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-AILocale": "1" }, body: JSON.stringify({ text: t }),
        }).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
        let next = fetchWav(list[0]);
        for (let i = 0; i < list.length && !this.cancelSpeak; i++) {
          const blob = await next;
          if (i + 1 < list.length) next = fetchWav(list[i + 1]);
          if (!blob || this.cancelSpeak) { if (!blob) { this.status.tts = false; await this._speakLocal(list.slice(i)); } break; }
          await new Promise((res) => {
            const a = new Audio(URL.createObjectURL(blob));
            this.audio = a;
            a.onended = a.onerror = () => { URL.revokeObjectURL(a.src); res(); };
            a.play().catch(res);
          });
        }
      } else {
        await this._speakLocal(list);
      }
    } finally {
      this.speaking = false;
      stopBarge?.();
    }
  }

  _speakLocal(list) {
    const synth = window.speechSynthesis;
    if (!synth) return Promise.resolve();
    const voice = this._localVoice();
    return list.reduce((p, t) => p.then(() => new Promise((res) => {
      if (this.cancelSpeak) { res(); return; }
      const u = new SpeechSynthesisUtterance(t);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || (this.getLang() === "it" ? "it-IT" : "en-US");
      u.rate = 1.03;
      u.onend = u.onerror = () => res();
      synth.speak(u);
    })), Promise.resolve());
  }
}
