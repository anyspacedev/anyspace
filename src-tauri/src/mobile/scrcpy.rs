// scrcpy server launcher.
//
// View-only for v1 — `control=false`, `audio=false`. The server is configured
// with `tunnel_forward=true`, `send_dummy_byte=true`, `send_frame_meta=false`,
// `send_codec_meta=false`, `send_device_meta=false`. The host:
//
//   1. locates a `scrcpy-server` JAR via the common install paths
//      (`/usr/share/scrcpy/`, brew, etc.) — vendoring our own JAR is a
//      future commit;
//   2. detects the installed scrcpy version (the JAR pins to a specific
//      version and the Server class rejects mismatches);
//   3. `adb push`es the JAR, picks a free local TCP port, runs
//      `adb forward tcp:<port> localabstract:scrcpy_<scid>`, and spawns
//      `adb shell CLASSPATH=… app_process / com.genymobile.scrcpy.Server …`;
//   4. opens a TCP connection to the forwarded port — the first byte is a
//      "dummy" handshake marker, the rest is raw H.264 Annex-B.
//
// Bytes from the video socket are pumped to the frontend via a tauri Channel.
// NALU/access-unit framing is done in the WebCodecs decoder on the JS side.

use anyhow::{anyhow, bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::time::{sleep, timeout};

/// Grace period to let `adb shell` close its stdio pipe naturally after the
/// device-side server exits. We avoid killing the host adb client up-front
/// because that races with the pipe flush — past attempts showed empty
/// captures despite scrcpy actually printing a stack trace.
const FAILURE_GRACE: Duration = Duration::from_millis(800);

/// Hard ceiling on output collection. If the host adb client is somehow stuck,
/// we kill it and take whatever's already buffered.
const FAILURE_LOG_TIMEOUT: Duration = Duration::from_secs(3);

const SERVER_REMOTE_PATH: &str = "/data/local/tmp/scrcpy-server.jar";

/// Common locations the scrcpy package installs its server JAR. Order is
/// preference: distro packages first, brew, then build-from-source defaults.
const SERVER_CANDIDATES: &[&str] = &[
    "/usr/share/scrcpy/scrcpy-server",
    "/usr/local/share/scrcpy/scrcpy-server",
    "/opt/homebrew/share/scrcpy/scrcpy-server",
    "/opt/scrcpy/scrcpy-server",
];

#[derive(Debug, Clone)]
pub struct ScrcpyOpts {
    pub adb: PathBuf,
    pub serial: String,
    /// 0 = preserve native size; otherwise longest edge in pixels.
    pub max_size: u32,
    pub bit_rate: u32,
}

pub struct ScrcpyHandle {
    pub child: Child,
    pub video: TcpStream,
    pub control: TcpStream,
    pub local_port: u16,
    pub adb: PathBuf,
    pub serial: String,
}

fn locate_server() -> Option<PathBuf> {
    for p in SERVER_CANDIDATES {
        if Path::new(p).is_file() {
            return Some(PathBuf::from(p));
        }
    }
    None
}

async fn detect_version() -> Result<String> {
    // The JAR's version must match what the Server class checks against, so
    // we read it from the installed scrcpy CLI (which ships paired with its
    // JAR by every packaging path we currently support).
    let out = Command::new("scrcpy")
        .arg("--version")
        .output()
        .await
        .context("running `scrcpy --version` (install scrcpy: `apt install scrcpy` or `brew install scrcpy`)")?;
    if !out.status.success() {
        bail!("`scrcpy --version` exited with {}", out.status);
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    // First line: "scrcpy 2.7\n..." (sometimes "scrcpy 2.7-rcN" or trailing branch info).
    let version = stdout
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .map(|t| t.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("unexpected `scrcpy --version` output: {stdout:?}"))?;
    Ok(version)
}

fn generate_scid() -> String {
    // 8 hex chars / 31 bits. The server parses scid via Java's
    // `Integer.parseInt(value, 16)`, which only accepts values in the *signed*
    // int range — anything with the high bit set (>= 0x80000000) throws
    // NumberFormatException, the server exits before disableSystemStreams(),
    // and the socket closes with the dummy byte never written. Result: roughly
    // half of all connections would fail with "early eof". Masking the top bit
    // matches scrcpy's own client (random 31-bit non-negative).
    let n: u32 = rand::random::<u32>() & 0x7FFF_FFFF;
    format!("{n:08x}")
}

async fn run_adb(adb: &Path, serial: &str, args: &[&str]) -> Result<()> {
    let mut cmd = Command::new(adb);
    cmd.args(["-s", serial]);
    cmd.args(args);
    let out = cmd.output().await.context("spawn adb")?;
    if !out.status.success() {
        bail!(
            "adb {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

/// Collects whatever the scrcpy server printed before dying. We give the
/// adb-shell tunnel a grace period to close on its own (the device-side
/// process has typically already exited by the time we get here) so the pipe
/// drains; only kill if it's still alive past the grace. As a last-resort
/// fallback, also dump the last few logcat lines tagged `scrcpy:*` — the
/// server's `Ln.*` writes to both stdout/stderr *and* logcat.
async fn capture_failure_logs(adb: &Path, serial: &str, mut child: Child) -> String {
    sleep(FAILURE_GRACE).await;
    if matches!(child.try_wait(), Ok(None)) {
        let _ = child.start_kill();
    }
    let output = match timeout(FAILURE_LOG_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(out)) => Some(out),
        _ => None,
    };
    let mut sections: Vec<String> = Vec::new();
    if let Some(out) = output {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !stderr.is_empty() {
            sections.push(format!("scrcpy server stderr:\n{stderr}"));
        }
        if !stdout.is_empty() {
            sections.push(format!("scrcpy server stdout:\n{stdout}"));
        }
    }
    if let Some(lc) = recent_scrcpy_logcat(adb, serial).await {
        sections.push(format!("device logcat (scrcpy + AndroidRuntime):\n{lc}"));
    }
    if sections.is_empty() {
        "(no output captured from scrcpy server or logcat)".into()
    } else {
        sections.join("\n\n")
    }
}

/// Pulls the tail of `adb logcat` filtered to scrcpy's tag plus AndroidRuntime
/// errors (which catch unhandled exceptions from `app_process`). `-d` makes
/// logcat dump-and-exit; `-t 80` limits to the last ~80 lines. Returns None
/// when logcat fails or contains nothing useful.
async fn recent_scrcpy_logcat(adb: &Path, serial: &str) -> Option<String> {
    let res = timeout(
        Duration::from_secs(2),
        Command::new(adb)
            .args([
                "-s",
                serial,
                "logcat",
                "-d",
                "-t",
                "80",
                "scrcpy:V",
                "AndroidRuntime:E",
                "*:S",
            ])
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !res.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&res.stdout).trim().to_string();
    if text.is_empty() || text.contains("--------- beginning of") && text.lines().count() <= 2 {
        None
    } else {
        Some(text)
    }
}

async fn connect_with_retry(port: u16, deadline: Duration) -> Result<TcpStream> {
    let start = std::time::Instant::now();
    let mut last_err: Option<std::io::Error> = None;
    while start.elapsed() < deadline {
        match TcpStream::connect(("127.0.0.1", port)).await {
            Ok(s) => return Ok(s),
            Err(e) => {
                last_err = Some(e);
                sleep(Duration::from_millis(80)).await;
            }
        }
    }
    Err(anyhow!(
        "scrcpy server didn't accept on local port {port} within {deadline:?}: {:?}",
        last_err
    ))
}

/// Connect to the adb-forwarded port and read the dummy handshake byte,
/// retrying the whole sequence on early-EOF. With tunnel_forward=true there
/// is a window where our local TCP connect succeeds (the host adb listener
/// is always up after `adb forward`) but adbd has nothing to bridge it to,
/// because the server hasn't run `new LocalServerSocket(name)` yet — adbd
/// closes the stream and we read 0 bytes. Just connecting again later fixes
/// it. We use a short per-attempt read timeout so the loop pivots quickly.
async fn connect_and_handshake(port: u16, deadline: Duration) -> Result<TcpStream> {
    let start = std::time::Instant::now();
    let mut last_err = anyhow!("no attempts made");
    while start.elapsed() < deadline {
        let mut stream = match TcpStream::connect(("127.0.0.1", port)).await {
            Ok(s) => s,
            Err(e) => {
                last_err = anyhow!("TCP connect to 127.0.0.1:{port} failed: {e}");
                sleep(Duration::from_millis(80)).await;
                continue;
            }
        };
        let mut dummy = [0u8; 1];
        match timeout(Duration::from_millis(400), stream.read_exact(&mut dummy)).await {
            Ok(Ok(_)) => return Ok(stream),
            Ok(Err(e)) => {
                last_err =
                    anyhow!("server abstract socket not yet ready (early eof on dummy: {e})");
            }
            Err(_) => {
                last_err = anyhow!("server didn't send handshake byte within 400ms");
            }
        }
        drop(stream);
        sleep(Duration::from_millis(120)).await;
    }
    Err(last_err.context(format!(
        "scrcpy server never completed handshake within {deadline:?}"
    )))
}

pub async fn spawn(opts: ScrcpyOpts) -> Result<ScrcpyHandle> {
    let server_path = locate_server().ok_or_else(|| {
        anyhow!(
            "scrcpy-server not found in any of: {}. Install scrcpy with \
             `apt install scrcpy`, `brew install scrcpy`, or build from source.",
            SERVER_CANDIDATES.join(", ")
        )
    })?;
    let version = detect_version().await?;
    let scid = generate_scid();

    // 1. Push JAR.
    run_adb(
        &opts.adb,
        &opts.serial,
        &[
            "push",
            server_path.to_string_lossy().as_ref(),
            SERVER_REMOTE_PATH,
        ],
    )
    .await
    .context("pushing scrcpy-server.jar")?;

    // 2. Reserve a local TCP port (let the OS pick an ephemeral one).
    let local_port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .context("binding ephemeral local port")?;
        let port = listener.local_addr()?.port();
        drop(listener);
        port
    };

    let abstract_name = format!("localabstract:scrcpy_{scid}");
    let local_spec = format!("tcp:{local_port}");

    // 3. adb forward.
    run_adb(
        &opts.adb,
        &opts.serial,
        &["forward", &local_spec, &abstract_name],
    )
    .await
    .context("setting up adb forward")?;

    // 4. Spawn the server. The first positional arg MUST be the version
    // string — the server compares it to its own constant and exits if it
    // doesn't match.
    let server_args = build_server_args(&version, &scid, &opts);
    let child = Command::new(&opts.adb)
        .args(["-s", &opts.serial, "shell"])
        .arg(format!("CLASSPATH={SERVER_REMOTE_PATH}"))
        .arg("app_process")
        .arg("/")
        .arg("com.genymobile.scrcpy.Server")
        .args(&server_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("spawning adb shell scrcpy")?;

    // 5+6. Connect and read the dummy handshake byte in a single retry loop.
    // The server writes one byte on the FIRST accepted socket (video) so we
    // can confirm the tunnel before blocking on real frames. The retry inside
    // `connect_and_handshake` handles the inherent race of tunnel_forward=true
    // (host adb listener accepts before the device-side abstract socket is
    // bound).
    let video = match connect_and_handshake(local_port, Duration::from_secs(8)).await {
        Ok(s) => s,
        Err(e) => {
            let logs = capture_failure_logs(&opts.adb, &opts.serial, child).await;
            let _ = run_adb(&opts.adb, &opts.serial, &["forward", "--remove", &local_spec]).await;
            return Err(e.context(format!(
                "scrcpy {version} server (JAR at {})",
                server_path.display()
            ))
            .context(logs));
        }
    };

    // 7. Second connection: control socket. The server accepts in declaration
    // order — video, then (optional audio), then control.
    let control = match connect_with_retry(local_port, Duration::from_secs(3)).await {
        Ok(s) => s,
        Err(e) => {
            let logs = capture_failure_logs(&opts.adb, &opts.serial, child).await;
            let _ = run_adb(&opts.adb, &opts.serial, &["forward", "--remove", &local_spec]).await;
            return Err(e.context("connecting to scrcpy control socket").context(logs));
        }
    };

    Ok(ScrcpyHandle {
        child,
        video,
        control,
        local_port,
        adb: opts.adb,
        serial: opts.serial,
    })
}

fn build_server_args(version: &str, scid: &str, opts: &ScrcpyOpts) -> Vec<String> {
    vec![
        version.to_string(),
        format!("scid={scid}"),
        "log_level=info".into(),
        "tunnel_forward=true".into(),
        "video=true".into(),
        "audio=false".into(),
        "control=true".into(),
        "video_codec=h264".into(),
        format!("video_bit_rate={}", opts.bit_rate),
        format!("max_size={}", opts.max_size),
        "send_device_meta=false".into(),
        "send_codec_meta=false".into(),
        "send_frame_meta=false".into(),
        "send_dummy_byte=true".into(),
        "cleanup=true".into(),
        "power_on=true".into(),
        "clipboard_autosync=false".into(),
    ]
}

/// Best-effort teardown: kills the adb shell child, removes the local forward.
/// Safe to call multiple times.
pub async fn cleanup(adb: &Path, serial: &str, local_port: u16, child: &mut Child) {
    let _ = child.start_kill();
    let _ = run_adb(adb, serial, &["forward", "--remove", &format!("tcp:{local_port}")]).await;
}

// We avoid pulling in the `rand` crate just for an scid — fall back to system
// time + getpid mixed via a cheap LCG. Quality doesn't matter, just uniqueness
// across concurrent sessions for one user.
mod rand {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static SEED: AtomicU64 = AtomicU64::new(0);

    pub fn random<T: From<u32>>() -> T {
        let mut s = SEED.load(Ordering::Relaxed);
        if s == 0 {
            let t = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(1);
            s = t ^ (std::process::id() as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        }
        // splitmix64
        s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = s;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        SEED.store(s, Ordering::Relaxed);
        T::from((z & 0xFFFF_FFFF) as u32)
    }
}
