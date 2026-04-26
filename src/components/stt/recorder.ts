// Audio capture: getUserMedia → MediaRecorder → Blob, with a live AnalyserNode
// exposed for the waveform UI. Single instance — only one recording at a time.

type RecorderState = "idle" | "recording";

let state: RecorderState = "idle";
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mimeType = "audio/webm";
let startedAt = 0;

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "audio/webm";
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

  mimeType = pickMime();
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(100); // collect chunks every 100ms so a fast stop still has data
  state = "recording";
  startedAt = performance.now();
  return { analyser, mime: mimeType };
}

export type StopResult = { blob: Blob; mime: string; durationMs: number };

export function stopRecording(): Promise<StopResult> {
  if (state !== "recording" || !recorder) {
    return Promise.reject(new Error("not recording"));
  }
  const rec = recorder;
  return new Promise<StopResult>((resolve, reject) => {
    rec.onerror = (e) => {
      cleanup();
      reject(new Error("recorder error: " + String(e)));
    };
    rec.onstop = () => {
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
