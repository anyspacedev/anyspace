//! Desktop OAuth bridge.
//!
//! Clerk's in-WebView OAuth dies under WebKit ITP: the Set-Cookie that
//! seeds the OAuth state during the cross-site XHR handshake never lands
//! in the cookie jar, so the callback to `clerk.<host>/v1/oauth_callback`
//! returns 403 `authorization_invalid`.
//!
//! We work around that by moving the OAuth round-trip into the user's
//! real default browser (where cookies work) and bringing the resulting
//! session back via a short-lived Clerk sign-in ticket. The dance:
//!
//!   1. JS calls `desktop_auth_begin` → we bind 127.0.0.1:0 and return
//!      the port + a random nonce.
//!   2. JS opens the bridge URL in the system browser (plugin-shell).
//!   3. User completes sign-in there; the bridge calls our backend to
//!      mint a Clerk sign-in ticket, then redirects to
//!      `http://127.0.0.1:<port>/callback?ticket=…&nonce=…`.
//!   4. This module's listener thread receives the GET, verifies the
//!      nonce, emits `desktop:auth:ticket`, and tears down.
//!   5. JS redeems the ticket via `signIn.create({ strategy: "ticket" })`
//!      and calls `setActive`. Clerk's localStorage fallback (`__clerk_db_jwt`)
//!      keeps the session alive even when ITP blocks Set-Cookie.
//!
//! Stage 1 (current): the bridge URL points at an in-process fake page
//! served by this same listener so the desktop half can be smoke-tested
//! before the anyspace.dev bridge + api.anyspace.dev mint-ticket endpoint
//! ship. Flip `desktop_auth_bridge_url` (or `VITE_DESKTOP_AUTH_BRIDGE_URL`)
//! to swap in the real bridge — the loopback handler doesn't care which
//! side originated the redirect, only that the nonce matches.

pub mod commands;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Response, Server};

/// Listener auto-tears-down after this long if no callback arrives. Keeps
/// a forgotten sign-in from leaving a port pinned forever.
const LISTENER_TIMEOUT: Duration = Duration::from_secs(120);

/// `recv_timeout` poll interval. Short enough that `cancel()` feels
/// immediate to the user, long enough not to burn a core idling.
const POLL_INTERVAL: Duration = Duration::from_millis(250);

pub struct DesktopAuthManager {
    inner: Mutex<Option<Active>>,
}

struct Active {
    /// Flipped to `true` by `cancel()` or after a successful callback;
    /// the listener thread checks each poll cycle and exits.
    shutdown: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
pub struct DesktopAuthSession {
    pub port: u16,
    pub nonce: String,
}

#[derive(Serialize, Clone)]
struct TicketEvent {
    ticket: String,
}

#[derive(Serialize, Clone)]
struct ErrorEvent {
    error: String,
}

/// Anything that can deliver "ticket" / "error" events back to the JS side.
/// `AppEmitter` wraps Tauri's `AppHandle::emit`; tests use a recording impl.
pub trait AuthEmitter {
    fn emit_ticket(&self, ticket: &str);
    fn emit_error(&self, error: &str);
}

struct AppEmitter(AppHandle);

impl AuthEmitter for AppEmitter {
    fn emit_ticket(&self, ticket: &str) {
        let _ = self.0.emit(
            "desktop:auth:ticket",
            TicketEvent {
                ticket: ticket.to_string(),
            },
        );
    }
    fn emit_error(&self, error: &str) {
        let _ = self.0.emit(
            "desktop:auth:error",
            ErrorEvent {
                error: error.to_string(),
            },
        );
    }
}

impl DesktopAuthManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn begin(&self, app: AppHandle) -> Result<DesktopAuthSession, String> {
        self.begin_with_emitter(AppEmitter(app))
    }

    /// Same as `begin` but with an injectable emitter so tests can capture
    /// events without standing up a full Tauri app.
    pub fn begin_with_emitter<E: AuthEmitter + Send + 'static>(
        &self,
        emitter: E,
    ) -> Result<DesktopAuthSession, String> {
        // Cancel any in-flight listener before starting a new one. The
        // user clicking Sign In twice shouldn't leak the first port.
        self.cancel();

        let server = Server::http("127.0.0.1:0")
            .map_err(|e| format!("loopback bind failed: {e}"))?;
        let port = match server.server_addr() {
            tiny_http::ListenAddr::IP(sa) => sa.port(),
            other => return Err(format!("unexpected listen addr: {other:?}")),
        };
        let nonce = mint_nonce();
        let shutdown = Arc::new(AtomicBool::new(false));

        let nonce_thread = nonce.clone();
        let shutdown_thread = shutdown.clone();
        thread::spawn(move || {
            run_listener(server, emitter, nonce_thread, shutdown_thread);
        });

        *self.inner.lock().unwrap() = Some(Active { shutdown });
        Ok(DesktopAuthSession { port, nonce })
    }

    pub fn cancel(&self) {
        if let Some(active) = self.inner.lock().unwrap().take() {
            active.shutdown.store(true, Ordering::SeqCst);
        }
    }
}

fn mint_nonce() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn run_listener<E: AuthEmitter>(
    server: Server,
    emitter: E,
    nonce: String,
    shutdown: Arc<AtomicBool>,
) {
    let started = Instant::now();
    loop {
        if shutdown.load(Ordering::SeqCst) {
            return;
        }
        if started.elapsed() > LISTENER_TIMEOUT {
            shutdown.store(true, Ordering::SeqCst);
            emitter.emit_error("timeout");
            return;
        }
        let req = match server.recv_timeout(POLL_INTERVAL) {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(_) => return,
        };

        let url = req.url().to_string();
        let (path, query) = split_url(&url);
        match path {
            "/fake-bridge" => {
                let body = FAKE_BRIDGE_HTML;
                let resp = Response::from_string(body)
                    .with_header(html_header())
                    .with_status_code(200);
                let _ = req.respond(resp);
            }
            "/callback" => {
                let qs = parse_query(query);
                let supplied_nonce = qs.get("nonce").map(String::as_str).unwrap_or("");
                let ticket = qs.get("ticket").map(String::as_str).unwrap_or("");
                if supplied_nonce != nonce || ticket.is_empty() {
                    let resp = Response::from_string("bad request")
                        .with_status_code(400);
                    let _ = req.respond(resp);
                    // Don't tear down — could be a stray local probe; let
                    // the real callback (or the timeout) end the session.
                    continue;
                }
                let resp = Response::from_string(CALLBACK_SUCCESS_HTML)
                    .with_header(html_header())
                    .with_status_code(200);
                let _ = req.respond(resp);
                emitter.emit_ticket(ticket);
                shutdown.store(true, Ordering::SeqCst);
                return;
            }
            _ => {
                let resp = Response::from_string("not found").with_status_code(404);
                let _ = req.respond(resp);
            }
        }
    }
}

fn html_header() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
        .expect("static header literal is valid")
}

fn split_url(url: &str) -> (&str, &str) {
    match url.find('?') {
        Some(i) => (&url[..i], &url[i + 1..]),
        None => (url, ""),
    }
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    if query.is_empty() {
        return out;
    }
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("");
        let v = it.next().unwrap_or("");
        if k.is_empty() {
            continue;
        }
        out.insert(percent_decode(k), percent_decode(v));
    }
    out
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'+' {
            out.push(b' ');
            i += 1;
        } else if b == b'%' && i + 2 < bytes.len() {
            let hi = hex_val(bytes[i + 1]);
            let lo = hex_val(bytes[i + 2]);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
            out.push(b);
            i += 1;
        } else {
            out.push(b);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

const FAKE_BRIDGE_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AnySpace — Fake desktop sign-in bridge</title>
<style>
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 540px; margin: 60px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 8px 0; }
  .panel { background: #f7f7f8; border: 1px solid #e3e3e6; border-radius: 8px; padding: 16px; margin: 16px 0; }
  code { background: #ececef; padding: 1px 6px; border-radius: 3px; font-size: 12.5px; }
  button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid #2563eb; background: #2563eb; color: white; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  .warn { color: #92400e; background: #fef3c7; border-color: #fcd34d; }
</style>
</head>
<body>
<h1>Fake desktop sign-in bridge</h1>
<p>The desktop app's loopback listener is wired up. This page is served by the
Rust side and stands in for the real <code>anyspace.dev/desktop/sign-in</code> page
until the backend mint-ticket endpoint ships.</p>

<div class="panel">
<p><strong>Return URL:</strong> <code id="returnTo"></code></p>
<p><strong>Nonce:</strong> <code id="nonce"></code></p>
<p><strong>Provider:</strong> <code id="provider"></code></p>
</div>

<p>Clicking <em>Approve</em> redirects to the loopback with a fake ticket. The
desktop app will receive the event, then attempt to redeem the ticket against
Clerk — that step will <strong>fail with a Clerk error</strong> because the
ticket isn't real. That's expected at this stage; it verifies the wiring up to
(but not past) ticket redemption.</p>

<button id="approve" type="button">Approve sign-in</button>

<script>
  var q = new URLSearchParams(location.search);
  var returnTo = q.get("return_to") || "";
  var nonce = q.get("nonce") || "";
  var provider = q.get("provider") || "";
  document.getElementById("returnTo").textContent = returnTo;
  document.getElementById("nonce").textContent = nonce;
  document.getElementById("provider").textContent = provider;
  document.getElementById("approve").onclick = function () {
    var ticket = "fake-ticket-" + Math.random().toString(36).slice(2);
    var url = returnTo + "?ticket=" + encodeURIComponent(ticket) + "&nonce=" + encodeURIComponent(nonce);
    location.href = url;
  };
</script>
</body>
</html>"#;

const CALLBACK_SUCCESS_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signed in — AnySpace</title>
<style>
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 420px; margin: 80px auto; padding: 0 16px; text-align: center; color: #1a1a1a; }
  h1 { font-size: 18px; margin: 0 0 12px; }
</style>
</head>
<body>
<h1>You can close this tab</h1>
<p>AnySpace is finishing sign-in.</p>
</body>
</html>"#;

#[cfg(test)]
mod tests {
    //! Exercises the loopback listener end-to-end via blocking HTTP. The
    //! Tauri-dependent `begin()` (which takes an `AppHandle`) is skipped;
    //! tests go through `begin_with_emitter` with a channel-backed
    //! emitter so success/failure is observable without a desktop GUI.
    //!
    //! Run with: `cd src-tauri && cargo test --lib auth::tests`

    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::time::Duration;

    /// Recording emitter: every emit pushes a tag + payload down a channel
    /// the test consumes via `recv_timeout`.
    struct ChanEmitter {
        tx: Sender<(&'static str, String)>,
    }

    impl AuthEmitter for ChanEmitter {
        fn emit_ticket(&self, ticket: &str) {
            let _ = self.tx.send(("ticket", ticket.to_string()));
        }
        fn emit_error(&self, error: &str) {
            let _ = self.tx.send(("error", error.to_string()));
        }
    }

    fn start_listener() -> (DesktopAuthManager, DesktopAuthSession, Receiver<(&'static str, String)>) {
        let mgr = DesktopAuthManager::new();
        let (tx, rx) = channel();
        let session = mgr
            .begin_with_emitter(ChanEmitter { tx })
            .expect("begin should bind");
        (mgr, session, rx)
    }

    /// Minimal HTTP/1.0 GET — keeps the test free of a reqwest dep just to
    /// hit 127.0.0.1.
    fn http_get(port: u16, path: &str) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let req = format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
        s.write_all(req.as_bytes()).unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).unwrap();
        // "HTTP/1.0 200 OK\r\n…"
        let status: u16 = buf
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let body_pos = buf.find("\r\n\r\n").map(|i| i + 4).unwrap_or(buf.len());
        let body = buf[body_pos..].to_string();
        (status, body)
    }

    #[test]
    fn nonce_mismatch_returns_400_and_no_event() {
        let (_mgr, session, rx) = start_listener();
        let (status, _body) = http_get(
            session.port,
            "/callback?ticket=abc&nonce=wrong",
        );
        assert_eq!(status, 400, "nonce mismatch must return 400");
        // No event should fire within a generous window.
        let got = rx.recv_timeout(Duration::from_millis(400));
        assert!(got.is_err(), "expected no event, got {got:?}");
    }

    #[test]
    fn valid_callback_fires_ticket_event_and_serves_success_page() {
        let (_mgr, session, rx) = start_listener();
        let nonce = session.nonce.clone();
        let path = format!("/callback?ticket=fake-ticket-xyz&nonce={nonce}");
        let (status, body) = http_get(session.port, &path);
        assert_eq!(status, 200);
        assert!(
            body.contains("You can close this tab"),
            "success body missing marker, got: {body:?}"
        );
        let (tag, payload) = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("ticket event should fire");
        assert_eq!(tag, "ticket");
        assert_eq!(payload, "fake-ticket-xyz");
    }

    #[test]
    fn fake_bridge_route_serves_html() {
        let (_mgr, session, _rx) = start_listener();
        let (status, body) = http_get(session.port, "/fake-bridge?nonce=abc");
        assert_eq!(status, 200);
        assert!(
            body.contains("Fake desktop sign-in bridge"),
            "fake-bridge body missing marker, got first 200: {:?}",
            &body.chars().take(200).collect::<String>()
        );
    }

    #[test]
    fn cancel_tears_down_listener_promptly() {
        let (mgr, session, _rx) = start_listener();
        // Confirm port is live first.
        let (status, _) = http_get(session.port, "/fake-bridge");
        assert_eq!(status, 200);
        mgr.cancel();
        // Listener thread polls every 250ms; give it a beat.
        std::thread::sleep(Duration::from_millis(700));
        // Connecting after cancel should fail-fast (port released).
        let res = TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", session.port).parse().unwrap(),
            Duration::from_millis(250),
        );
        assert!(res.is_err(), "port {} still bound after cancel", session.port);
    }

    #[test]
    fn percent_decode_handles_common_cases() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("a+b"), "a b");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("%2F%3D"), "/=");
        // Malformed percent escape passes through unchanged.
        assert_eq!(percent_decode("%ZZ"), "%ZZ");
    }
}
