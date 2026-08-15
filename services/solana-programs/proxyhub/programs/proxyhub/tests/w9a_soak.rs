//! Wave 9.A soak cluster: initialize_program → register_listing_commitment
//! creates a ListingCommitment PDA. Not a catalog. Not programs/session.
//!
//! Native `processor!` panics on Anchor 0.32 (`solana-invoke` requires
//! `target_os = "solana"`). This soak loads SBF `proxyhub.so`. Rebuild with
//! ListingCommitment before claiming a PDA. Does not upgrade live GCP/devnet.

use anchor_lang::{prelude::AccountMeta, InstructionData, ToAccountMetas};
use proxyhub::{accounts as accs, instruction as ixn, ID as PROGRAM_ID, ListingCommitment};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use std::path::PathBuf;

const SESSION_PROGRAM: &str = "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb";
const PROXYHUB_ID: &str = "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu";
const LISTING_MARKER: &[u8] = b"Listing commitment registered";

fn program_state_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"program_state"], &PROGRAM_ID)
}

fn listing_commitment_pda(provider: &Pubkey, offer_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"listing-commitment", provider.as_ref(), offer_hash.as_ref()],
        &PROGRAM_ID,
    )
}

fn deploy_so() -> Option<PathBuf> {
    let candidates = [
        std::env::var("SBF_OUT_DIR")
            .ok()
            .map(|d| PathBuf::from(d).join("proxyhub.so")),
        std::env::var("BPF_OUT_DIR")
            .ok()
            .map(|d| PathBuf::from(d).join("proxyhub.so")),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/proxyhub.so")),
    ];
    candidates.into_iter().flatten().find(|p| p.is_file())
}

fn so_has_listing_commitment(path: &PathBuf) -> bool {
    std::fs::read(path)
        .map(|b| b.windows(LISTING_MARKER.len()).any(|w| w == LISTING_MARKER))
        .unwrap_or(false)
}

fn ix(data: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data,
    }
}

async fn send(
    ctx: &mut ProgramTestContext,
    ixs: &[Instruction],
    extra: &[&Keypair],
) -> Result<(), solana_program_test::BanksClientError> {
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut signers: Vec<&Keypair> = vec![&ctx.payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(ixs, Some(&ctx.payer.pubkey()), &signers, bh);
    ctx.banks_client.process_transaction(tx).await
}

#[tokio::test]
async fn w9a_register_listing_commitment_ok() {
    assert_eq!(PROGRAM_ID.to_string(), PROXYHUB_ID);
    assert_ne!(PROGRAM_ID.to_string(), SESSION_PROGRAM);

    let so = deploy_so().expect("proxyhub.so missing — rebuild with ListingCommitment");
    assert!(
        so_has_listing_commitment(&so),
        "{} lacks ListingCommitment marker; current BC-06 artifact is not enough",
        so.display()
    );
    std::env::set_var("SBF_OUT_DIR", so.parent().expect("so parent").as_os_str());

    let pt = ProgramTest::new("proxyhub", PROGRAM_ID, None);
    let mut ctx = pt.start_with_context().await;
    let admin = ctx.payer.pubkey();
    let (state, _) = program_state_pda();

    send(
        &mut ctx,
        &[ix(
            ixn::InitializeProgram {
                min_oracle_signatures: 1,
            }
            .data(),
            accs::InitializeProgram {
                program_state: state,
                admin,
                system_program: solana_sdk::system_program::id(),
            }
            .to_account_metas(None),
        )],
        &[],
    )
    .await
    .unwrap();

    let provider = Keypair::new().pubkey();
    let mut offer_hash = [0u8; 32];
    offer_hash[0] = 0xab;
    let listing_id = [0x12u8; 16];
    let (commitment, _) = listing_commitment_pda(&provider, &offer_hash);

    send(
        &mut ctx,
        &[ix(
            ixn::RegisterListingCommitment {
                provider,
                offer_hash,
                listing_id,
            }
            .data(),
            accs::RegisterListingCommitment {
                listing_commitment: commitment,
                oracle: admin,
                program_state: state,
                system_program: solana_sdk::system_program::id(),
            }
            .to_account_metas(None),
        )],
        &[],
    )
    .await
    .unwrap();

    let acct = ctx
        .banks_client
        .get_account(commitment)
        .await
        .unwrap()
        .expect("listing commitment PDA");
    assert_eq!(acct.owner, PROGRAM_ID);
    assert!(acct.data.len() >= ListingCommitment::LEN);
    assert_eq!(&acct.data[8..40], provider.as_ref());
    assert_eq!(&acct.data[40..72], &offer_hash);
    assert_eq!(&acct.data[72..88], &listing_id);
    assert_eq!(acct.data[88], 1, "is_active");
    println!(
        "pda={} provider={} program={} so={} session_rejected=1",
        commitment,
        provider,
        PROGRAM_ID,
        so.display()
    );
    println!("W9A_LISTING_COMMITMENT_SOAK_OK");
}
