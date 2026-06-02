//! Buyer connection admission helpers (P2 §5.2).

use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

/// Minimal HTTP/1.1 503 before closing the socket (buyer never reached hyper).
pub async fn write_service_unavailable_and_close(stream: &mut TcpStream) {
    const RESPONSE: &[u8] = b"HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nContent-Length: 19\r\nConnection: close\r\n\r\nService Unavailable";
    let _ = stream.write_all(RESPONSE).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn writes_http_503_and_closes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");

        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            write_service_unavailable_and_close(&mut stream).await;
        });

        let mut client = TcpStream::connect(addr).await.expect("connect");
        let mut buf = [0u8; 256];
        let n = client.read(&mut buf).await.expect("read");
        let body = std::str::from_utf8(&buf[..n]).expect("utf8");
        assert!(
            body.contains("503"),
            "expected 503 response, got: {body:?}"
        );
    }
}
