//! Wave 8.D localnet soak: bond → accuse → warp challenge window → resolve_slash
//! moves lamports to treasury. Does not deploy `programs/session`. Does not
//! claim live economic slash on GCP.

use anchor_lang::{prelude::AccountMeta, InstructionData, ToAccountMetas};
use proxy_gateway_bond::{
    accounts as accs, instruction as ixn, ID as PROGRAM_ID, MIN_CHALLENGE_WINDOW_SECS,
};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction, system_program,
    transaction::Transaction,
};

const SESSION_PROGRAM: &str = "8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb";
const LOCALNET_ID: &str = "7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5";
const MIN_STAKE: u64 = 1_000_000;
const BOND_AMOUNT: u64 = 2_000_000_000;
const SLASH_BPS: u16 = 5_000;

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[proxy_gateway_bond::SEED_CONFIG], &PROGRAM_ID)
}

fn bond_pda(operator: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[proxy_gateway_bond::SEED_BOND, operator.as_ref()], &PROGRAM_ID)
}

fn challenge_pda(operator: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[proxy_gateway_bond::SEED_CHALLENGE, operator.as_ref()],
        &PROGRAM_ID,
    )
}

async fn send(
    ctx: &mut ProgramTestContext,
    ixs: &[Instruction],
    extra: &[&Keypair],
) -> Result<(), BanksClientError> {
    let bh = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let mut signers: Vec<&Keypair> = vec![&ctx.payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(ixs, Some(&ctx.payer.pubkey()), &signers, bh);
    ctx.banks_client.process_transaction(tx).await
}

async fn lamports(ctx: &mut ProgramTestContext, pk: Pubkey) -> u64 {
    ctx.banks_client.get_balance(pk).await.unwrap()
}

async fn fund(ctx: &mut ProgramTestContext, dest: &Pubkey, amount: u64) {
    send(
        ctx,
        &[system_instruction::transfer(
            &ctx.payer.pubkey(),
            dest,
            amount,
        )],
        &[],
    )
    .await
    .unwrap();
}

fn ix(data: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts,
        data,
    }
}

fn native_entry(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    type AnchorEntry = unsafe fn(&Pubkey, &[AccountInfo], &[u8]) -> ProgramResult;
    let entry: AnchorEntry =
        unsafe { std::mem::transmute(proxy_gateway_bond::entry as *const ()) };
    unsafe { entry(program_id, accounts, data) }
}

#[tokio::test]
async fn w8d_bond_slash_ok_after_challenge_window() {
    assert_eq!(PROGRAM_ID.to_string(), LOCALNET_ID);
    assert_ne!(PROGRAM_ID.to_string(), SESSION_PROGRAM);

    let pt = ProgramTest::new(
        "proxy_gateway_bond",
        PROGRAM_ID,
        processor!(native_entry),
    );
    let mut ctx = pt.start_with_context().await;

    let admin = ctx.payer.pubkey();
    let operator = Keypair::new();
    let accuser = Keypair::new();
    let treasury = Keypair::new();
    fund(&mut ctx, &operator.pubkey(), 5_000_000_000).await;
    fund(&mut ctx, &accuser.pubkey(), 2_000_000_000).await;
    fund(&mut ctx, &treasury.pubkey(), 1_000_000).await;

    let (config, _) = config_pda();
    let (bond, _) = bond_pda(&operator.pubkey());
    let (challenge, _) = challenge_pda(&operator.pubkey());

    send(
        &mut ctx,
        &[ix(
            ixn::InitializeConfig {
                accuser: accuser.pubkey(),
                treasury: treasury.pubkey(),
                challenge_window_secs: MIN_CHALLENGE_WINDOW_SECS,
                unbonding_secs: MIN_CHALLENGE_WINDOW_SECS,
                min_stake_lamports: MIN_STAKE,
                max_slash_bps: SLASH_BPS,
            }
            .data(),
            accs::InitializeConfig {
                config,
                admin,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )],
        &[],
    )
    .await
    .expect("initialize_config");

    send(
        &mut ctx,
        &[ix(
            ixn::SetDeployAllowed { allowed: true }.data(),
            accs::AdminConfig {
                config,
                admin,
            }
            .to_account_metas(None),
        )],
        &[],
    )
    .await
    .expect("set_deploy_allowed");

    send(
        &mut ctx,
        &[ix(
            ixn::Bond { amount: BOND_AMOUNT }.data(),
            accs::Bond {
                bond,
                config,
                operator: operator.pubkey(),
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )],
        &[&operator],
    )
    .await
    .expect("bond");

    let mut evidence = [0u8; 32];
    evidence[0] = 7;
    send(
        &mut ctx,
        &[ix(
            ixn::Accuse {
                evidence_hash: evidence,
                slash_bps: SLASH_BPS,
            }
            .data(),
            accs::Accuse {
                operator: operator.pubkey(),
                bond,
                challenge,
                config,
                accuser: accuser.pubkey(),
                system_program: system_program::id(),
            }
            .to_account_metas(None),
        )],
        &[&accuser],
    )
    .await
    .expect("accuse");

    let early = send(
        &mut ctx,
        &[ix(
            ixn::ResolveSlash {}.data(),
            accs::ResolveSlash {
                operator: operator.pubkey(),
                bond,
                challenge,
                config,
                admin,
                treasury: treasury.pubkey(),
                accuser_rent: accuser.pubkey(),
            }
            .to_account_metas(None),
        )],
        &[],
    )
    .await;
    assert!(early.is_err(), "resolve_slash must fail before the window");

    let mut clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    clock.unix_timestamp = clock
        .unix_timestamp
        .saturating_add(MIN_CHALLENGE_WINDOW_SECS + 1);
    ctx.set_sysvar(&clock);

    let treasury_before = lamports(&mut ctx, treasury.pubkey()).await;
    let expected_slash = proxy_gateway_bond::slash_lamports(BOND_AMOUNT, SLASH_BPS).unwrap();

    send(
        &mut ctx,
        &[ix(
            ixn::ResolveSlash {}.data(),
            accs::ResolveSlash {
                operator: operator.pubkey(),
                bond,
                challenge,
                config,
                admin,
                treasury: treasury.pubkey(),
                accuser_rent: accuser.pubkey(),
            }
            .to_account_metas(None),
        )],
        &[],
    )
    .await
    .expect("resolve_slash after window");

    let treasury_after = lamports(&mut ctx, treasury.pubkey()).await;
    assert_eq!(
        treasury_after.saturating_sub(treasury_before),
        expected_slash,
        "treasury must receive stake * 5000 / 10000"
    );
    println!(
        "treasury_delta={} expected={} program={} session_rejected=1",
        treasury_after - treasury_before,
        expected_slash,
        PROGRAM_ID
    );
    println!("W8D_BOND_SLASH_OK");
}
