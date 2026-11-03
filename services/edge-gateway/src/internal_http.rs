//! Private management/peer ingress. Never admits ordinary buyer proxy traffic.
pub fn allowed<B>(request: &hyper::Request<B>) -> bool {
    if request.method() == hyper::Method::CONNECT {
        // The existing peer handler verifies the shared gateway credential.
        return crate::internal_forward::is_internal_forward_request(request);
    }
    if request.uri().scheme().is_some() {
        return false;
    }
    let path = request.uri().path();
    matches!(
        path,
        "/health" | "/ready" | "/metrics" | "/api/v1/network/status"
    ) || path.starts_with("/internal/")
        || path.starts_with("/admin/")
        || path.starts_with("/debug/")
}

#[cfg(test)]
mod tests {
    #[test]
    fn private_listener_rejects_buyer_proxy_traffic() {
        for request in [
            hyper::Request::builder()
                .method("CONNECT")
                .uri("example.com:443")
                .body(())
                .unwrap(),
            hyper::Request::builder()
                .uri("http://example.com/")
                .body(())
                .unwrap(),
            hyper::Request::builder()
                .uri("/")
                .header("Host", "example.com")
                .body(())
                .unwrap(),
        ] {
            assert!(!super::allowed(&request));
        }
        assert!(super::allowed(
            &hyper::Request::builder().uri("/health").body(()).unwrap()
        ));
        assert!(super::allowed(
            &hyper::Request::builder()
                .method("CONNECT")
                .uri("bridge.internal")
                .header(crate::internal_forward::HDR_INTERNAL, "1")
                .body(())
                .unwrap()
        ));
    }
}
