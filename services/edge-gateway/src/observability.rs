//! P5: tracing bootstrap (fmt always; optional OTLP when built with `--features otel`).

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Initialize global tracing from `RUST_LOG` and optional OpenTelemetry env.
pub fn init() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    #[cfg(feature = "otel")]
    {
        if let Ok(endpoint) = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT") {
            if !endpoint.trim().is_empty() {
                if init_otel(&filter, &endpoint).is_ok() {
                    return;
                }
                eprintln!(
                    "OTEL_EXPORTER_OTLP_ENDPOINT={endpoint} set but OTLP init failed; falling back to fmt"
                );
            }
        }
    }

    tracing_subscriber::fmt().with_env_filter(filter).init();
}

#[cfg(feature = "otel")]
fn init_otel(
    filter: &EnvFilter,
    endpoint: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use opentelemetry::global;
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry::KeyValue;
    use opentelemetry_otlp::WithExportConfig;
    use opentelemetry_sdk::trace::TracerProvider;
    use opentelemetry_sdk::Resource;

    let service_name =
        std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "edge-gateway".to_string());

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint)
        .build()?;

    let resource =
        Resource::new_with_defaults([KeyValue::new("service.name", service_name.clone())]);

    let provider = TracerProvider::builder()
        .with_simple_exporter(exporter)
        .with_resource(resource)
        .build();

    global::set_tracer_provider(provider.clone());
    let tracer = provider.tracer(service_name.clone());
    let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    tracing_subscriber::registry()
        .with(filter.clone())
        .with(tracing_subscriber::fmt::layer())
        .with(otel_layer)
        .init();

    tracing::info!(
        service = %service_name,
        endpoint = %endpoint,
        "OpenTelemetry OTLP tracing enabled"
    );
    Ok(())
}

/// Root span for buyer CONNECT tunnel setup (selection + 200 response).
#[inline]
pub fn buyer_connect_span(session_id: &str, proxy_target: &str) -> tracing::Span {
    tracing::info_span!(
        "edge.buyer_connect",
        otel.name = "buyer.connect",
        session.id = %session_id,
        proxy.target = %proxy_target,
    )
}

/// Background bridge after CONNECT 200 (yamux or peer forward).
#[inline]
pub fn buyer_connect_bridge_span(
    session_id: &str,
    node_id: &str,
    proxy_target: &str,
) -> tracing::Span {
    tracing::info_span!(
        "edge.buyer_connect_bridge",
        otel.name = "buyer.connect.bridge",
        session.id = %session_id,
        provider.node_id = %node_id,
        proxy.target = %proxy_target,
    )
}

/// Registry / directory provider pick for a session.
#[inline]
pub fn provider_select_span(session_id: &str, proxy_target: Option<&str>) -> tracing::Span {
    tracing::info_span!(
        "edge.provider_select",
        otel.name = "provider.select",
        session.id = %session_id,
        proxy.target = tracing::field::display(proxy_target.unwrap_or("unknown")),
    )
}

/// Local yamux byte bridge to a selected provider.
#[inline]
pub fn provider_bridge_span(node_id: &str, proxy_target: &str) -> tracing::Span {
    tracing::info_span!(
        "edge.provider_bridge",
        otel.name = "provider.bridge",
        provider.node_id = %node_id,
        proxy.target = %proxy_target,
    )
}

/// Provider tunnel handshake + yamux accept loop (per TCP/TLS accept).
#[inline]
pub fn provider_tunnel_accept_span(peer: &str) -> tracing::Span {
    tracing::info_span!(
        "edge.provider_tunnel_accept",
        otel.name = "provider.tunnel.accept",
        net.peer.ip = %peer,
    )
}
