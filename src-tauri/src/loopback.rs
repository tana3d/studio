//! Single-use browser loopback callback for desktop sign-in.
//!
//! Design: bind 127.0.0.1 on an ephemeral port, build a PKCE-style challenge,
//! open the system browser to the identity service, then accept exactly one
//! GET request on the callback path carrying the attempt's `state`. No
//! credentials cross the webview boundary; the verifier never leaves this
//! process. Sign in
//! with ChatGPT uses `/auth/callback` (`Flow::receive`).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    str,
    sync::atomic::{AtomicBool, Ordering},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const TIMEOUT: Duration = Duration::from_secs(180);
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_BYTES: usize = 8192;
const EPHEMERAL_PORT_MIN: u16 = 49152;

type Result<T> = std::result::Result<T, String>;

pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn random() -> Result<Zeroizing<String>> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| "Could not generate a secure sign-in.".to_string())?;
    Ok(Zeroizing::new(URL_SAFE_NO_PAD.encode(bytes)))
}

pub struct Flow {
    listener: TcpListener,
    cancelled: Arc<AtomicBool>,
    pub port: u16,
    pub verifier: Zeroizing<String>,
    state: Zeroizing<String>,
}

pub struct CloseHandle {
    cancelled: Arc<AtomicBool>,
}

impl CloseHandle {
    pub fn close(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

impl Flow {
    pub fn bind() -> Result<Self> {
        // Retry until the OS hands back a port in the ephemeral range. Some
        // systems allocate below 49152; keep trying rather than expose a bad port.
        for _ in 0..64 {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .map_err(|_| "Could not listen for browser sign-in. Please retry.".to_string())?;
            let port = listener
                .local_addr()
                .map_err(|_| "Could not read the sign-in port.".to_string())?
                .port();
            if port < EPHEMERAL_PORT_MIN {
                continue;
            }
            return Ok(Self {
                listener,
                cancelled: Arc::new(AtomicBool::new(false)),
                port,
                verifier: random()?,
                state: random()?,
            });
        }
        Err("No ephemeral sign-in port is available. Please retry.".into())
    }

    pub fn close_handle(&self) -> CloseHandle {
        CloseHandle {
            cancelled: Arc::clone(&self.cancelled),
        }
    }

    /// The attempt's anti-forgery value, for providers whose authorize URL
    /// this module does not build.
    pub fn state(&self) -> &str {
        &self.state
    }

    /// Accept one GET on `path` whose `state` matches this attempt, and hand
    /// back its other query parameters for the caller to validate.
    pub fn receive(self, path: &str) -> Result<(Query, Zeroizing<String>, Completion)> {
        let Self {
            listener,
            cancelled,
            port,
            verifier,
            state,
        } = self;
        listener
            .set_nonblocking(true)
            .map_err(|_| "Could not configure the sign-in listener.".to_string())?;

        let deadline = Instant::now() + TIMEOUT;
        let (mut stream, peer) = loop {
            if cancelled.load(Ordering::Relaxed) {
                return Err("Sign-in cancelled.".into());
            }
            if Instant::now() >= deadline {
                return Err("Sign-in timed out waiting for your browser. Please try again.".into());
            }
            match listener.accept() {
                Ok(pair) => break pair,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                    continue;
                }
                Err(_) => return Err("Could not receive browser sign-in. Please retry.".into()),
            }
        };

        stream
            .set_read_timeout(Some(READ_TIMEOUT))
            .map_err(|_| "Could not configure the sign-in socket.".to_string())?;

        let mut bytes = Zeroizing::new(Vec::new());
        let mut chunk = [0u8; 256];
        loop {
            if bytes.len() >= MAX_REQUEST_BYTES {
                return Err("Invalid browser callback. Please retry.".into());
            }
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    bytes.extend_from_slice(&chunk[..n]);
                    if bytes.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    return Err("Browser callback timed out. Please retry.".into())
                }
                Err(_) => return Err("Could not read browser callback. Please retry.".into()),
            }
        }

        let query = validate(&bytes, peer, port, path, &state)?;
        Ok((query, verifier, Completion(stream)))
    }
}

/// A callback's query parameters other than `state`, in order.
pub type Query = Vec<(String, Zeroizing<String>)>;

/// The one value named `key`, if it appears exactly once.
pub fn single<'a>(query: &'a Query, key: &str) -> Option<&'a str> {
    let mut values = query.iter().filter(|(name, _)| name == key);
    let value = values.next()?;
    values.next().is_none().then_some(value.1.as_str())
}

/// A valid callback is not yet a successful exchange. The caller writes a
/// success response only once the token has been stored in the OS vault.
pub struct Completion(TcpStream);

impl Completion {
    /// A self-contained page with no redirect, for other providers.
    pub fn respond_page(self, success: bool, heading: &str) {
        let _ = self.write(success, heading, "");
    }

    fn write(mut self, success: bool, heading: &str, location: &str) -> std::io::Result<()> {
        let (status, guidance) = if success {
            ("200 OK", "You can close this tab and return to the app.")
        } else {
            (
                "400 Bad Request",
                "Return to the app and start sign-in again. You can close this tab.",
            )
        };
        let body = format!(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Studio sign-in</title><style>body{{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;background:#070B10;color:#F5F7F6}}main{{max-width:28rem;padding:2rem}}</style></head><body><main><h1>{heading}</h1><p>{guidance}</p></main></body></html>"
        );
        let response = format!(
            "HTTP/1.1 {status}\r\n{location}Content-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        self.0.set_write_timeout(Some(Duration::from_secs(1))).ok();
        self.0.write_all(response.as_bytes())
    }
}

fn validate(bytes: &[u8], peer: SocketAddr, port: u16, path: &str, state: &str) -> Result<Query> {
    let invalid = || "Invalid browser callback. Please start sign-in again.".to_string();
    if peer.ip() != std::net::Ipv4Addr::LOCALHOST {
        return Err(invalid());
    }
    let text = str::from_utf8(bytes).map_err(|_| invalid())?;
    let mut lines = text.split("\r\n");
    let line = lines.next().ok_or_else(invalid)?;
    let parts: Vec<_> = line.split(' ').collect();
    if parts.len() != 3
        || parts[0] != "GET"
        || parts[2] != "HTTP/1.1"
        || !parts[1].starts_with(&format!("{path}?"))
        || parts[1].contains('#')
    {
        return Err(invalid());
    }

    let mut hosts = Vec::new();
    for line in lines.take_while(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or_else(invalid)?;
        if name.eq_ignore_ascii_case("host") {
            hosts.push(value.trim());
        }
        if name.eq_ignore_ascii_case("transfer-encoding")
            || (name.eq_ignore_ascii_case("content-length") && value.trim() != "0")
        {
            return Err(invalid());
        }
    }
    if hosts != [format!("127.0.0.1:{port}")] {
        return Err(invalid());
    }

    let url = reqwest::Url::parse(&format!("http://127.0.0.1:{port}{}", parts[1]))
        .map_err(|_| invalid())?;
    if url.path() != path {
        return Err(invalid());
    }
    let mut query: Query = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), Zeroizing::new(value.into_owned())))
        .collect();
    if single(&query, "state") != Some(state) {
        return Err("Browser sign-in did not match this attempt. Please start again.".into());
    }
    query.retain(|(key, _)| key != "state");
    Ok(query)
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = "s7ate";

    fn request(target: &str, port: u16) -> Vec<u8> {
        format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").into_bytes()
    }

    fn peer() -> SocketAddr {
        "127.0.0.1:50000".parse().unwrap()
    }

    #[test]
    fn other_paths_return_their_parameters_without_state() {
        let bytes = request(
            &format!("/auth/callback?code=abc&scope=openid+email&state={STATE}&client_id=app_1"),
            49200,
        );
        let query = validate(&bytes, peer(), 49200, "/auth/callback", STATE).unwrap();
        assert_eq!(single(&query, "code"), Some("abc"));
        assert_eq!(single(&query, "scope"), Some("openid email"));
        assert_eq!(single(&query, "client_id"), Some("app_1"));
        assert_eq!(single(&query, "state"), None);
    }

    #[test]
    fn a_forged_or_missing_state_is_refused() {
        let forged = request("/auth/callback?code=abc&state=other", 49200);
        assert!(validate(&forged, peer(), 49200, "/auth/callback", STATE).is_err());
        let doubled = request(
            &format!("/auth/callback?code=abc&state={STATE}&state={STATE}"),
            49200,
        );
        assert!(validate(&doubled, peer(), 49200, "/auth/callback", STATE).is_err());
        let missing = request("/auth/callback?code=abc", 49200);
        assert!(validate(&missing, peer(), 49200, "/auth/callback", STATE).is_err());
    }

    #[test]
    fn the_wrong_path_host_or_peer_is_refused() {
        let path = request(&format!("/callback?code=abc&state={STATE}"), 49200);
        assert!(validate(&path, peer(), 49200, "/auth/callback", STATE).is_err());
        let host = request(&format!("/auth/callback?code=abc&state={STATE}"), 49201);
        assert!(validate(&host, peer(), 49200, "/auth/callback", STATE).is_err());
        let remote: SocketAddr = "10.0.0.2:50000".parse().unwrap();
        let bytes = request(&format!("/auth/callback?code=abc&state={STATE}"), 49200);
        assert!(validate(&bytes, remote, 49200, "/auth/callback", STATE).is_err());
    }
}
