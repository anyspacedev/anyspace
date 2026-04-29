# ast-test — self-hosted ASR benchmark

Benchmarks three ASR options on the same 60-second clip per language
(en / zh / ja / ko) so we can pick what to wire into the app's STT settings.

| # | Model | Disk | Why it's here |
| - | --- | --- | --- |
| 1 | `iic/SenseVoiceSmall` (PyTorch via `funasr`) | ~470 MB | Reference: claims en/zh/ja/ko + 50 langs, 15× faster than Whisper-Large on GPU. |
| 2 | SenseVoice via `sherpa-onnx` int8 | ~230 MB | What we'd actually self-host on a CPU box. |
| 3 | `FunAudioLLM/Fun-ASR-MLT-Nano-2512` (PyTorch) | ~3 GB | Newer Tongyi Lab multilingual model; 31 langs incl. Korean. |

All three are run **CPU-only** here (no GPU on this host). Numbers are not
comparable to the GPU figures in the upstream papers.

## Phase 0 — disk prep (mandatory)

This box has ~2.6 GB free on `/`. The three models total ~3.7 GB. Pick **one**:

```bash
# A) Free space on / (run from anywhere)
docker system prune -af
uv cache prune
sudo apt-get clean

# B) Or: relocate model caches to a roomier mount before running anything
export HF_HOME=/mnt/data/hf
export MODELSCOPE_CACHE=/mnt/data/ms
mkdir -p "$HF_HOME" "$MODELSCOPE_CACHE"
```

Each `bench_*.py` will refuse to run if `shutil.disk_usage()` on its model
cache shows less than `model_size + 500 MB` free.

## Run

```bash
cd ast-test
uv sync                                       # creates .venv, installs deps
uv run python scripts/fetch_audio.py          # ~10 MB of public-domain clips
uv run python scripts/bench_sensevoice.py     # downloads ~470 MB on first run
uv run python scripts/bench_sherpa.py         # downloads ~230 MB on first run
uv run python scripts/bench_funasr_mlt.py     # downloads ~3 GB; needs HF_HOME
cat results/results.json | python -m json.tool
```

Pass criteria: 12 rows in `results.json` (3 models × 4 languages), each with
non-empty `text`.

## Bring your own audio

If the auto-fetch fails (Common Voice now usually requires an HF token) drop
your own 16 kHz mono WAVs at:

```
audio/en.wav
audio/zh.wav
audio/ja.wav
audio/ko.wav
```

`fetch_audio.py` skips any file that already exists.

## Output schema

`results/results.json` is a JSON array; each row:

```json
{
  "model":       "sensevoice-small",
  "lang":        "en",
  "audio_sec":   60.0,
  "load_sec":    4.81,
  "infer_sec":   2.13,
  "rtf":         0.0355,
  "peak_rss_mb": 1820,
  "text":        "..."
}
```

`rtf = infer_sec / audio_sec`. Sub-1.0 means faster than real time;
sub-0.1 means the model could comfortably stream in the app.

## Manual accuracy review

Speed alone doesn't decide the winner. After running, open `results.json`
and score each `text` field against the ground-truth transcript (printed at
the top of `fetch_audio.py`'s output) on a 1–5 scale:

| Score | Meaning |
| --- | --- |
| 5 | Perfect or near-perfect; punctuation correct. |
| 4 | A few small errors, fully understandable. |
| 3 | Several errors but gist preserved. |
| 2 | Garbled in places; needs heavy editing. |
| 1 | Unusable. |

Record scores under "Eval" in this README for the final pick.

## Wiring the winner into the app

The app's STT client (`src-tauri/src/stt/commands.rs:69`) calls
`{endpoint}/audio/transcriptions` against any OpenAI-compatible server.
Both SenseVoice (`SenseVoiceSmall_OpenAI` community wrappers,
`silero-funasr-server`) and sherpa-onnx (`sherpa-onnx-server` with the
OpenAI proxy script) ship matching servers. Once you've picked a model,
point `presetId: "custom"` at the local URL in
`src/stores/sttStore.ts:47`.

That edit is **out of scope here** — this folder just produces the numbers.

## Results (run on AMD EPYC, 4 vCPUs, 8 GB RAM, no GPU — 2026-04-29)

| Model | Load (s) | Infer / 60 s clip | RTF | Peak RSS | en/zh/ja/ko quality |
| --- | --- | --- | --- | --- | --- |
| `sensevoice-small` (torch) | 90 (incl. ~1 GB d/l) | 3.5 – 3.7 s | 0.058 – 0.062 | 3092 MB | All 4 readable, occasional homophones (e.g. "code" vs "gold"). |
| `sherpa-onnx-int8` | **0.97** | **1.8 – 2.0 s** | **0.030 – 0.034** | **810 MB** | Same SenseVoice weights, int8 quantized — quality should match the torch row above modulo quantization noise. |
| `fun-asr-mlt-nano-2512` | OOM | OOM | OOM | OOM | Killed by oom-killer at load. Bundles Qwen3-0.6B LLM + 800 M audio encoder; needs **≥16 GB RAM** or a GPU. |

`infer` is the timed inference pass; the warm-up pass before each language is
not counted. Audio is the SenseVoice repo's `example/<lang>.mp3` (5–7 s)
loop-padded to exactly 60 s — perfectly clean studio TTS-grade speech, so
quality scores here are an upper bound vs real-world conditions.

## Recommendation

For self-hosting on this kind of small CPU box: **`sherpa-onnx-int8`**.

- 4× lower RAM (810 MB vs 3 GB) — the entire model fits in cache and can run
  alongside the existing app without pressure.
- Sub-second cold start vs 90 s for funasr+ModelScope.
- ~2× faster inference than the PyTorch reference and still RTF ~0.03,
  i.e. real-time × 30.
- Same weights as the SenseVoice paper; quality difference is just int8
  quantization noise.
- Has a maintained `sherpa-onnx-server` that exposes an HTTP API, which the
  app's `stt_transcribe` (already an OpenAI-compatible client) can hit by
  pointing the `custom` preset at the local URL. No code changes needed in
  `src-tauri/src/stt/commands.rs:69`.

`fun-asr-mlt-nano-2512` is interesting but realistically targets a GPU box
or 16 GB+ RAM machine — not viable on the current host.

## Demo server (recorder page → transcription)

`scripts/server.py` is a small FastAPI app that loads the **sherpa-onnx int8
SenseVoice** recognizer once at startup and exposes:

- `GET /` — single-page browser recorder (MediaRecorder → POST audio).
- `POST /audio/transcriptions` — OpenAI-shaped multipart endpoint.
  Body: `file=<audio>`, optional `language=` (`en|zh|ja|ko|yue|auto`).
  Response: `{"text": ..., "audio_sec", "decode_sec", "infer_sec", "rtf", "lang_hint"}`.
- `GET /healthz`.

Run:

```bash
uv run python scripts/server.py            # binds 0.0.0.0:9000
uv run python scripts/server.py --port 8000
```

Open the firewall port:

```bash
sudo ufw allow 9000/tcp comment "ast-test demo ASR"
```

### Browsers require a secure origin for the microphone

Chrome and Firefox refuse `getUserMedia` over plain `http://<public-ip>:port/`.
**`http://localhost`** and **`http://127.0.0.1`** are exempt. So:

- Easiest: SSH port-forward and open in your local browser:
  ```bash
  ssh -L 9000:localhost:9000 user@<server>
  # then visit http://localhost:9000/ on your laptop
  ```
- Or front it with HTTPS (caddy / nginx + Let's Encrypt) if you want
  shareable URLs.

### Quick API smoke test (no browser needed)

```bash
curl -X POST http://127.0.0.1:9000/audio/transcriptions \
     -F "file=@audio/en.wav" -F "language=en" | python -m json.tool
```

## Wiring into the app (next step, not done here)

1. Stand up sherpa-onnx HTTP server (e.g. via the
   `python-api-examples/non_streaming_server.py` shipped in the sherpa-onnx
   repo, fronted by a thin OpenAI-API shim).
2. Open Settings → STT in the app, switch preset to **Custom**, set:
   - Endpoint = `http://127.0.0.1:<port>`
   - Model = `sense-voice-zh-en-ja-ko-yue-int8`
   - Language = blank (auto-detect) or per-pane.
3. Default values live in `src/stores/sttStore.ts:47`; the request goes
   through `src-tauri/src/stt/commands.rs:69`. No code change required —
   the `custom` preset already does what we need.
