// Build script for Edge Gateway
// Compiles protobuf definitions for gRPC blockchain streaming

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create output directory if it doesn't exist
    std::fs::create_dir_all("src/blockchain/proto")?;
    
    // Compile protobuf definitions
    tonic_build::configure()
        .build_server(false)
        .build_client(true)
        .out_dir("src/blockchain/proto")
        .compile_protos(&["proto/blockchain.proto"], &["proto"])?;
    
    // Rerun if proto file changes
    println!("cargo:rerun-if-changed=proto/blockchain.proto");
    
    Ok(())
}
