use crate::circuit::{BatchDigestCircuit, PROVER_K};
use halo2_proofs::{
    pasta::EqAffine,
    plonk::{keygen_pk, keygen_vk, ProvingKey, VerifyingKey},
    poly::commitment::Params,
};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter},
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone)]
pub struct ProverKeys {
    pub params: Arc<Params<EqAffine>>,
    pub pk: Arc<ProvingKey<EqAffine>>,
    pub vk: Arc<VerifyingKey<EqAffine>>,
    pub keys_dir: PathBuf,
    pub params_sha256_hex: String,
    pub created_new_params: bool,
}

pub fn load_or_create_prover_keys(keys_dir: impl AsRef<Path>) -> Result<ProverKeys, String> {
    let keys_dir = keys_dir.as_ref().to_path_buf();
    fs::create_dir_all(&keys_dir)
        .map_err(|e| format!("create keys dir {}: {e}", keys_dir.display()))?;

    let params_path = keys_dir.join("params.bin");
    let vk_meta_path = keys_dir.join("vk.sha256");

    let (params, created_new_params) = if params_path.exists() {
        let file = File::open(&params_path)
            .map_err(|e| format!("open params.bin: {e}"))?;
        let mut reader = BufReader::new(file);
        let params = Params::<EqAffine>::read(&mut reader)
            .map_err(|e| format!("read params.bin: {e}"))?;
        (params, false)
    } else {
        tracing::info!(k = PROVER_K, path = %params_path.display(), "generating Halo2 params (one-time)");
        let params = Params::<EqAffine>::new(PROVER_K);
        let file = File::create(&params_path)
            .map_err(|e| format!("create params.bin: {e}"))?;
        let mut writer = BufWriter::new(file);
        params
            .write(&mut writer)
            .map_err(|e| format!("write params.bin: {e}"))?;
        (params, true)
    };

    let empty = BatchDigestCircuit::default();
    let vk = keygen_vk(&params, &empty).map_err(|e| format!("keygen_vk: {e}"))?;
    let pk = keygen_pk(&params, vk.clone(), &empty).map_err(|e| format!("keygen_pk: {e}"))?;

    let params_bytes = fs::read(&params_path).map_err(|e| format!("read params for hash: {e}"))?;
    let params_sha256_hex = hex::encode(Sha256::digest(&params_bytes));

    // Persist VK content hash for ops (not the proving key).
    let vk_hash = {
        let mut h = Sha256::new();
        h.update(params_sha256_hex.as_bytes());
        h.update(b"|halo2-ipa-pasta-v2|");
        h.update([PROVER_K as u8]);
        hex::encode(h.finalize())
    };
    fs::write(&vk_meta_path, format!("{vk_hash}\n"))
        .map_err(|e| format!("write vk.sha256: {e}"))?;

    // Touch pk marker so ops can see keys materialised (pk regenerated each boot).
    let _ = fs::write(keys_dir.join("pk.ready"), b"regenerated-from-params-each-boot\n");

    Ok(ProverKeys {
        params: Arc::new(params),
        pk: Arc::new(pk),
        vk: Arc::new(vk),
        keys_dir,
        params_sha256_hex,
        created_new_params,
    })
}
