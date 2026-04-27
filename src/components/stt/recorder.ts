// Audio capture: getUserMedia → MediaRecorder → Blob, with a live AnalyserNode
// exposed for the waveform UI. Single instance — only one recording at a time.
//
// WebKitGTK ships without MediaRecorder in some builds (constructor throws
// NotSupportedError), so we fall back to a ScriptProcessor PCM tap and encode
// the captured Float32 samples as a 16-bit WAV blob on stop.
import { playStartCue, playStopCue } from "./feedbackSounds";

type RecorderState = "idle" | "recording";

let state: RecorderState = "idle";
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mimeType = "audio/webm";
let startedAt = 0;

// PCM-fallback state, populated only when MediaRecorder is unavailable.
let pcmProcessor: ScriptProcessorNode | null = null;
let pcmSilentGain: GainNode | null = null;
let pcmBuffers: Float32Array[] = [];
let pcmSampleRate = 0;
let pcmFrames = 0;

function pickMime(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

function tryCreateMediaRecorder(s: MediaStream): MediaRecorder | null {
  if (typeof MediaRecorder === "undefined") return null;
  const picked = pickMime();
  try {
    return picked ? new MediaRecorder(s, { mimeType: picked }) : new MediaRecorder(s);
  } catch (e) {
    console.warn("[stt] MediaRecorder unavailable, will fall back to PCM/WAV:", e);
    return null;
  }
}

export type StartResult = { analyser: AnalyserNode; mime: string };

export async function startRecording(): Promise<StartResult> {
  if (state !== "idle") throw new Error("recorder busy");
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 64;
  analyser.smoothingTimeConstant = 0.6;
  src.connect(analyser);

  recorder = tryCreateMediaRecorder(stream);

  if (recorder) {
    mimeType = recorder.mimeType || pickMime() || "audio/webm";
    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.start(100); // collect chunks every 100ms so a fast stop still has data
  } else {
    // PCM fallback. ScriptProcessor only fires when its output reaches the
    // destination, so route through a muted GainNode to avoid echoing the mic
    // back to the speakers.
    pcmBuffers = [];
    pcmFrames = 0;
    pcmSampleRate = audioCtx.sampleRate;
    const proc = audioCtx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (ev) => {
      const data = ev.inputBuffer.getChannelData(0);
      pcmBuffers.push(new Float32Array(data));
      pcmFrames += data.length;
    };
    const silent = audioCtx.createGain();
    silent.gain.value = 0;
    src.connect(proc);
    proc.connect(silent);
    silent.connect(audioCtx.destination);
    pcmProcessor = proc;
    pcmSilentGain = silent;
    mimeType = "audio/wav";
  }

  playStartCue();
  state = "recording";
  startedAt = performance.now();
  return { analyser, mime: mimeType };
}

export type StopResult = { blob: Blob; mime: string; durationMs: number };

export function stopRecording(): Promise<StopResult> {
  if (state !== "recording") {
    return Promise.reject(new Error("not recording"));
  }

  if (recorder) {
    const rec = recorder;
    return new Promise<StopResult>((resolve, reject) => {
      rec.onerror = (e) => {
        cleanup();
        reject(new Error("recorder error: " + String(e)));
      };
      rec.onstop = () => {
        playStopCue();
        const durationMs = performance.now() - startedAt;
        const blob = new Blob(chunks, { type: mimeType });
        cleanup();
        resolve({ blob, mime: mimeType, durationMs });
      };
      try {
        rec.stop();
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // PCM fallback
  if (!pcmProcessor) {
    cleanup();
    return Promise.reject(new Error("not recording"));
  }
  playStopCue();
  const durationMs = performance.now() - startedAt;
  const blob = encodeWav(pcmBuffers, pcmFrames, pcmSampleRate);
  cleanup();
  return Promise.resolve({ blob, mime: "audio/wav", durationMs });
}

export function cancelRecording(): void {
  if (state === "idle") return;
  try {
    recorder?.stop();
  } catch {
    /* ignore */
  }
  cleanup();
}

function cleanup() {
  state = "idle";
  recorder = null;
  chunks = [];
  if (pcmProcessor) {
    try {
      pcmProcessor.disconnect();
    } catch {
      /* ignore */
    }
    pcmProcessor.onaudioprocess = null;
    pcmProcessor = null;
  }
  if (pcmSilentGain) {
    try {
      pcmSilentGain.disconnect();
    } catch {
      /* ignore */
    }
    pcmSilentGain = null;
  }
  pcmBuffers = [];
  pcmFrames = 0;
  pcmSampleRate = 0;
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  if (audioCtx) {
    void audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  analyser = null;
}

export function isRecording(): boolean {
  return state === "recording";
}

// Encode Float32 PCM buffers as a 16-bit mono WAV blob.
function encodeWav(buffers: Float32Array[], totalFrames: number, sampleRate: number): Blob {
  const headerSize = 44;
  const dataSize = totalFrames * 2; // 16-bit mono
  const buf = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buf);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = headerSize;
  for (const chunk of buffers) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buf], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
