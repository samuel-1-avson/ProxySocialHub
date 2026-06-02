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

    let service_name = std::env::var("OTEL_SERVICE_NAME")
        .unwrap_or_else(|_| "edge-gateway".to_string());

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint)
        .build()?;

    let resource = Resource::new_with_defaults([KeyValue::new("service.name", service_name.clone())]);

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
