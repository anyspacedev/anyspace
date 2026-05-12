//! On-device Whisper inference via `whisper-rs`.
//!
//! Gated behind the `local-stt` Cargo feature so contributors without cmake
//! / a C++ toolchain can still build. When the feature is off, the public
//! API returns a clear error message and the rest of the app keeps working.
//!
//! Design notes:
//! - `WhisperContext` creation is the slow part (~1–3 s for `small`). We
//!   cache one per model path in a process-global map and keep `Arc`s.
//! - GPU is probed *during the first context load*: try `use_gpu(true)`,
//!   fall back to `use_gpu(false)` on any failure. The result is cached
//!   for the rest of the session and surfaced through `current_gpu_status`.
//! - Audio always arrives as a 16-bit mono WAV blob (we force the
//!   recorder's `forceWav` path for this preset). Resampling to 16 kHz
//!   `f32` is done inline with linear interpolation — dictation-quality
//!   audio doesn't need polyphase, and dropping the `rubato` dep keeps the
//!   build surface small.

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuStatus {
    pub use_gpu: bool,
    /// "metal" | "vulkan" | "cuda" | "cpu" — describes the compiled-in
    /// backend that *would* be used if GPU init succeeded. When `use_gpu`
    /// is false this is always "cpu" even if a GPU backend is compiled in.
    pub backend: &'static str,
}

#[cfg(feature = "local-stt")]
mod imp {
    use super::GpuStatus;
    use anyhow::{anyhow, Context, Result};
    use once_cell::sync::OnceCell;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use whisper_rs::{
        FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
    };

    static CTX_CACHE: OnceCell<Mutex<HashMap<PathBuf, Arc<WhisperContext>>>> = OnceCell::new();
    static GPU_STATUS: OnceCell<GpuStatus> = OnceCell::new();

    fn compiled_backend() -> &'static str {
        // These cfg checks mirror the per-platform feature stanzas in
        // Cargo.toml. They tell us which GPU backend *might* work; the
        // actual probe happens at runtime by attempting to construct a
        // WhisperContext with use_gpu(true).
        #[cfg(all(target_os = "macos"))]
        {
            return "metal";
        }
        #[cfg(all(target_os = "linux"))]
        {
            return "vulkan";
        }
        #[cfg(all(target_os = "windows"))]
        {
            return "cpu"; // CUDA is opt-in via a self-build feature
        }
        #[allow(unreachable_code)]
        "cpu"
    }

    fn load_context(model_path: &Path) -> Result<(Arc<WhisperContext>, GpuStatus)> {
        let path_str = model_path
            .to_str()
            .ok_or_else(|| anyhow!("non-UTF8 model path"))?;
        let backend = compiled_backend();

        let try_load = |use_gpu: bool| -> Result<WhisperContext> {
            let mut params = WhisperContextParameters::default();
            params.use_gpu(use_gpu);
            WhisperContext::new_with_params(path_str, params)
                .map_err(|e| anyhow!("whisper init (gpu={use_gpu}): {e}"))
        };

        if backend != "cpu" {
            match try_load(true) {
                Ok(ctx) => {
                    let status = GpuStatus {
                        use_gpu: true,
                        backend,
                    };
                    eprintln!(
                        "[stt.local] context loaded with {} acceleration: {}",
                        backend,
                        model_path.display()
                    );
                    return Ok((Arc::new(ctx), status));
                }
                Err(e) => {
                    eprintln!(
                        "[stt.local] GPU ({backend}) init failed, retrying on CPU: {e}"
                    );
                }
            }
        }

        let ctx = try_load(false).context("CPU init failed")?;
        let status = GpuStatus {
            use_gpu: false,
            backend: "cpu",
        };
        eprintln!(
            "[stt.local] context loaded on CPU: {}",
            model_path.display()
        );
        Ok((Arc::new(ctx), status))
    }

    fn get_or_init(model_path: &Path) -> Result<Arc<WhisperContext>> {
        let cache = CTX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        // Fast path: already loaded.
        {
            let map = cache
                .lock()
                .map_err(|_| anyhow!("ctx cache poisoned"))?;
            if let Some(c) = map.get(model_path) {
                return Ok(c.clone());
            }
        }
        // Slow path: actually load. Held outside the lock so we don't
        // block other transcribes that target an already-loaded model.
        let (ctx, status) = load_context(model_path)?;
        let _ = GPU_STATUS.set(status);
        let mut map = cache
            .lock()
            .map_err(|_| anyhow!("ctx cache poisoned"))?;
        // Race: someone else might have inserted while we were loading.
        let entry = map.entry(model_path.to_path_buf()).or_insert(ctx);
        Ok(entry.clone())
    }

    pub fn current_gpu_status() -> Option<GpuStatus> {
        GPU_STATUS.get().cloned()
    }

    pub fn transcribe(
        wav_bytes: &[u8],
        model_path: &Path,
        language: Option<&str>,
    ) -> Result<String> {
        let (samples_i16, sample_rate) = parse_wav_mono(wav_bytes)?;
        let pcm_16k = resample_to_16k_f32(samples_i16, sample_rate);
        if pcm_16k.is_empty() {
            return Ok(String::new());
        }

        let ctx = get_or_init(model_path)?;
        let mut state = ctx
            .create_state()
            .map_err(|e| anyhow!("create_state: {e}"))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        if let Some(lang) = language {
            if !lang.is_empty() {
                params.set_language(Some(lang));
            }
        }
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        state
            .full(params, &pcm_16k)
            .map_err(|e| anyhow!("full: {e}"))?;

        let n = state
            .full_n_segments()
            .map_err(|e| anyhow!("n_segments: {e}"))?;
        let mut out = String::new();
        for i in 0..n {
            let seg = state
                .full_get_segment_text(i)
                .map_err(|e| anyhow!("seg {i}: {e}"))?;
            out.push_str(&seg);
        }
        Ok(out.trim().to_string())
    }

    /// Parses a canonical 16-bit PCM WAV blob into `(samples_mono_i16, sample_rate)`.
    /// Tolerates extra header chunks between `fmt ` and `data` (some encoders
    /// insert `LIST`/`JUNK`); validates bit depth and downmixes multi-channel
    /// to mono by averaging.
    fn parse_wav_mono(audio: &[u8]) -> Result<(Vec<i16>, u32)> {
        if audio.len() < 44 || &audio[0..4] != b"RIFF" || &audio[8..12] != b"WAVE" {
            return Err(anyhow!("not a RIFF/WAVE file"));
        }
        // fmt chunk lives right after "WAVE", canonical layout.
        if &audio[12..16] != b"fmt " {
            return Err(anyhow!("missing fmt chunk"));
        }
        let fmt_size = u32::from_le_bytes([audio[16], audio[17], audio[18], audio[19]]) as usize;
        let fmt_start = 20;
        if audio.len() < fmt_start + fmt_size {
            return Err(anyhow!("truncated fmt chunk"));
        }
        let format = u16::from_le_bytes([audio[fmt_start], audio[fmt_start + 1]]);
        if format != 1 {
            return Err(anyhow!("expected PCM format (1), got {format}"));
        }
        let channels = u16::from_le_bytes([audio[fmt_start + 2], audio[fmt_start + 3]]).max(1);
        let sample_rate = u32::from_le_bytes([
            audio[fmt_start + 4],
            audio[fmt_start + 5],
            audio[fmt_start + 6],
            audio[fmt_start + 7],
        ]);
        let bits_per_sample = u16::from_le_bytes([audio[fmt_start + 14], audio[fmt_start + 15]]);
        if bits_per_sample != 16 {
            return Err(anyhow!("expected 16-bit PCM, got {bits_per_sample}"));
        }

        // Walk past fmt looking for the `data` chunk.
        let mut offset = fmt_start + fmt_size;
        while offset + 8 <= audio.len() {
            let id = &audio[offset..offset + 4];
            let size = u32::from_le_bytes([
                audio[offset + 4],
                audio[offset + 5],
                audio[offset + 6],
                audio[offset + 7],
            ]) as usize;
            let body_start = offset + 8;
            let body_end = (body_start + size).min(audio.len());
            if id == b"data" {
                let bytes = &audio[body_start..body_end];
                let mut interleaved: Vec<i16> = Vec::with_capacity(bytes.len() / 2);
                for chunk in bytes.chunks_exact(2) {
                    interleaved.push(i16::from_le_bytes([chunk[0], chunk[1]]));
                }
                if channels > 1 {
                    let ch = channels as usize;
                    let mut mono = Vec::with_capacity(interleaved.len() / ch);
                    for frame in interleaved.chunks_exact(ch) {
                        let sum: i32 = frame.iter().map(|&s| s as i32).sum();
                        mono.push((sum / ch as i32) as i16);
                    }
                    return Ok((mono, sample_rate));
                }
                return Ok((interleaved, sample_rate));
            }
            offset = body_start + size;
        }
        Err(anyhow!("no data chunk found"))
    }

    /// Linear-interpolation resample to 16 kHz mono `f32` in [-1.0, 1.0].
    /// Whisper requires exactly 16 kHz; the recorder produces at the
    /// AudioContext's native rate (typically 44.1 or 48 kHz on Linux/macOS).
    fn resample_to_16k_f32(samples: Vec<i16>, sample_rate: u32) -> Vec<f32> {
        let normalize = |s: i16| -> f32 { s as f32 / 32768.0 };
        if sample_rate == 16_000 {
            return samples.into_iter().map(normalize).collect();
        }
        if samples.is_empty() {
            return Vec::new();
        }
        let src_len = samples.len();
        let ratio = 16_000.0_f64 / sample_rate as f64;
        let dst_len = (src_len as f64 * ratio).round() as usize;
        let mut out = Vec::with_capacity(dst_len);
        for i in 0..dst_len {
            let src_pos = i as f64 / ratio;
            let idx = src_pos as usize;
            let frac = (src_pos - idx as f64) as f32;
            let a = samples.get(idx).copied().map(normalize).unwrap_or(0.0);
            let b = samples
                .get(idx + 1)
                .copied()
                .map(normalize)
                .unwrap_or(a);
            out.push(a + (b - a) * frac);
        }
        out
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn make_wav(sample_rate: u32, channels: u16, samples: &[i16]) -> Vec<u8> {
            let data_size = (samples.len() * 2) as u32;
            let byte_rate = sample_rate * channels as u32 * 2;
            let block_align = channels * 2;
            let mut v: Vec<u8> = Vec::with_capacity(44 + data_size as usize);
            v.extend_from_slice(b"RIFF");
            v.extend_from_slice(&(36 + data_size).to_le_bytes());
            v.extend_from_slice(b"WAVE");
            v.extend_from_slice(b"fmt ");
            v.extend_from_slice(&16u32.to_le_bytes());
            v.extend_from_slice(&1u16.to_le_bytes()); // PCM
            v.extend_from_slice(&channels.to_le_bytes());
            v.extend_from_slice(&sample_rate.to_le_bytes());
            v.extend_from_slice(&byte_rate.to_le_bytes());
            v.extend_from_slice(&block_align.to_le_bytes());
            v.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
            v.extend_from_slice(b"data");
            v.extend_from_slice(&data_size.to_le_bytes());
            for s in samples {
                v.extend_from_slice(&s.to_le_bytes());
            }
            v
        }

        #[test]
        fn parses_mono_wav() {
            let wav = make_wav(16_000, 1, &[1, 2, 3, 4]);
            let (samples, sr) = parse_wav_mono(&wav).unwrap();
            assert_eq!(sr, 16_000);
            assert_eq!(samples, vec![1, 2, 3, 4]);
        }

        #[test]
        fn downmixes_stereo_wav() {
            // L=100, R=300 → 200 averaged
            let wav = make_wav(48_000, 2, &[100, 300, 200, 400]);
            let (samples, sr) = parse_wav_mono(&wav).unwrap();
            assert_eq!(sr, 48_000);
            assert_eq!(samples, vec![200, 300]);
        }

        #[test]
        fn resample_passthrough_at_16k() {
            let pcm = resample_to_16k_f32(vec![16384, -16384], 16_000);
            assert_eq!(pcm.len(), 2);
            assert!((pcm[0] - 0.5).abs() < 1e-3);
            assert!((pcm[1] + 0.5).abs() < 1e-3);
        }

        #[test]
        fn resample_48k_to_16k_shrinks_3x() {
            let src: Vec<i16> = (0..48_000).map(|_| 0).collect();
            let pcm = resample_to_16k_f32(src, 48_000);
            // Roughly 16k samples out, within rounding tolerance.
            assert!((pcm.len() as i64 - 16_000).abs() <= 2);
        }

        /// End-to-end smoke test: load a real Whisper model and transcribe a
        /// known WAV. `#[ignore]` because it needs ~75 MB of fixtures on
        /// disk. Run via:
        ///
        ///   mkdir -p /tmp/whisper-e2e && cd /tmp/whisper-e2e
        ///   curl -fsSL -o ggml-tiny.bin \
        ///     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin
        ///   curl -fsSL -o jfk.wav \
        ///     https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav
        ///   cargo test --features local-stt --lib stt::local:: \
        ///     transcribes_jfk_clip -- --ignored --nocapture
        #[test]
        #[ignore]
        fn transcribes_jfk_clip() {
            use std::path::PathBuf;
            let model = PathBuf::from("/tmp/whisper-e2e/ggml-tiny.bin");
            let wav_path = PathBuf::from("/tmp/whisper-e2e/jfk.wav");
            assert!(model.is_file(), "missing model at {}", model.display());
            assert!(wav_path.is_file(), "missing wav at {}", wav_path.display());

            let wav = std::fs::read(&wav_path).expect("read wav");
            let started = std::time::Instant::now();
            let text = super::transcribe(&wav, &model, Some("en"))
                .expect("transcribe");
            eprintln!("transcribed in {:?}: {}", started.elapsed(), text);

            let lower = text.to_lowercase();
            // The JFK clip's signature phrase. Tiny model is noisy but
            // always includes "country" — strong sanity check.
            assert!(
                lower.contains("country"),
                "expected 'country' in transcript, got: {text}"
            );
        }
    }
}

#[cfg(not(feature = "local-stt"))]
mod imp {
    use super::GpuStatus;
    use anyhow::{anyhow, Result};
    use std::path::Path;

    pub fn current_gpu_status() -> Option<GpuStatus> {
        None
    }

    pub fn transcribe(
        _wav_bytes: &[u8],
        _model_path: &Path,
        _language: Option<&str>,
    ) -> Result<String> {
        Err(anyhow!(
            "local STT not compiled in (build with --features local-stt)"
        ))
    }
}

pub use imp::{current_gpu_status, transcribe};
