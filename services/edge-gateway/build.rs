// Build script for Edge Gateway — compiles protobuf only when `blockchain` feature is enabled.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("CARGO_FEATURE_BLOCKCHAIN").is_err() {
        return Ok(());
    }

    std::fs::create_dir_all("src/blockchain/proto")?;

    tonic_build::configure()
        .build_server(false)
        .build_client(true)
        .out_dir("src/blockchain/proto")
        .compile_protos(&["proto/blockchain.proto"], &["proto"])?;

    println!("cargo:rerun-if-changed=proto/blockchain.proto");

    Ok(())
}
