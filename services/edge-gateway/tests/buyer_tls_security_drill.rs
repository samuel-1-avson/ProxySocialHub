//! Explicit local security drill using disposable fixtures. Run with --ignored.
#[path = "../src/tls.rs"]
mod tls;

use std::{
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf},
    net::{TcpListener, TcpStream},
};

struct CapturedStream {
    socket: TcpStream,
    wire: Arc<Mutex<Vec<u8>>>,
}
impl AsyncRead for CapturedStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut self.socket).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = result {
            self.wire
                .lock()
                .unwrap()
                .extend_from_slice(&buf.filled()[before..]);
        }
        result
    }
}
impl AsyncWrite for CapturedStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.socket).poll_write(cx, data)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.socket).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.socket).poll_shutdown(cx)
    }
}

async fn listener(
    config: &tls::TlsConfig,
) -> (
    u16,
    Arc<Mutex<Vec<u8>>>,
    tokio::task::JoinHandle<Option<Vec<u8>>>,
) {
    let acceptor = tls::create_buyer_tls_acceptor(config).expect("production buyer TLS acceptor");
    let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = socket.local_addr().unwrap().port();
    let wire = Arc::new(Mutex::new(Vec::new()));
    let captured = wire.clone();
    let task = tokio::spawn(async move {
        let (socket, _) = socket.accept().await.unwrap();
        let stream = CapturedStream {
            socket,
            wire: captured,
        };
        let Ok(mut stream) = acceptor.accept(stream).await else {
            return None;
        };
        let mut request = Vec::new();
        let mut buf = [0; 1024];
        while !request.windows(4).any(|b| b == b"\r\n\r\n") && request.len() < 8192 {
            let n = stream.read(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
            request.extend_from_slice(&buf[..n]);
        }
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .await
            .unwrap();
        Some(request)
    });
    (port, wire, task)
}

#[tokio::test]
#[ignore = "requires disposable TLS_DRILL_DIR fixtures; explicit security drill only"]
async fn buyer_tls_security_drill() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let dir = std::path::PathBuf::from(
        std::env::var("TLS_DRILL_DIR").expect("TLS_DRILL_DIR is required"),
    );
    let config = tls::TlsConfig {
        cert_path: dir.join("server.pem").to_string_lossy().into_owned(),
        key_path: dir.join("server-key.pem").to_string_lossy().into_owned(),
        ca_path: None,
        require_client_cert: false,
    };
    let root = reqwest::Certificate::from_pem(&std::fs::read(dir.join("ca.pem")).unwrap()).unwrap();
    let client = reqwest::Client::builder()
        .add_root_certificate(root.clone())
        .https_only(true)
        .http1_only()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let (port, wire, task) = listener(&config).await;
    let credential = "Basic c3ludGhldGljLWRyaWxsOm5vLXJlYWwtY3JlZGVudGlhbHM=";
    let response = client
        .get(format!("https://localhost:{port}/"))
        .header("Proxy-Authorization", credential)
        .send()
        .await
        .expect("trusted local TLS handshake");
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "ok");
    let clear = tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&clear).contains(credential));
    let wire = wire.lock().unwrap();
    assert!(
        !wire
            .windows(credential.len())
            .any(|b| b == credential.as_bytes()),
        "credential appeared outside TLS"
    );
    assert!(!String::from_utf8_lossy(&wire)
        .to_ascii_lowercase()
        .contains("proxy-authorization"));
    drop(wire);

    // Trust failure and hostname failure must prevent an HTTP request.
    for hostname_failure in [false, true] {
        let (port, _, task) = listener(&config).await;
        let mut builder = reqwest::Client::builder()
            .https_only(true)
            .http1_only()
            .timeout(Duration::from_secs(3));
        if hostname_failure {
            builder = builder.add_root_certificate(root.clone());
        }
        let host = if hostname_failure {
            "127.0.0.1"
        } else {
            "localhost"
        };
        assert!(builder
            .build()
            .unwrap()
            .get(format!("https://{host}:{port}/"))
            .send()
            .await
            .is_err());
        assert!(tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap()
            .is_none());
    }

    let (port, _, task) = listener(&config).await;
    let mut plaintext = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    plaintext
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap()
            .is_none(),
        "buyer TLS listener accepted plaintext"
    );
}
