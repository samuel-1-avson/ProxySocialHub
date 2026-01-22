use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Check multiple possible proto locations
    let proto_paths = [
        "proto/gateway.proto",       // Docker context (project root)
        "../../proto/gateway.proto", // Local development (from services/edge-gateway)
    ];

    for proto_path in proto_paths {
        if Path::new(proto_path).exists() {
            tonic_build::compile_protos(proto_path)?;
            return Ok(());
        }
    }

    // If no proto found, skip compilation (proto functionality optional for now)
    println!("cargo:warning=Proto file not found, skipping gRPC generation");
    Ok(())
}
