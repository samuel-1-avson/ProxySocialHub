# Runbook: Signing-Key Rotation & Emergency Freeze (W-28)

Scope: Solana signing keys used by `control-api` (oracle/multisig settler,
treasury hot payout signer, multisig cosigner). Production boot is
fail-closed: `PROXYHUB_MULTISIG_SETTLE_ENABLED=true`, a KMS/HSM signer
configured, no `ORACLE_PRIVATE_KEY`, no plaintext keypair files
(`ValidateSecurityPosture`). Keypair files, where still allowed
(dev/staging), must be `0600` — the loader refuses group/other access.

## Rotation (planned, quarterly or on suspicion)

1. **Provision the new key in KMS first.** Create the new GCP/AWS KMS key
   (Ed25519-compatible signing via the existing signer adapters). Record
   the new public key. Never export key material.
2. **Fund & register.** If the key is a fee payer or multisig member:
   fund the new public key with a small SOL float; add it on-chain
   (multisig signer set / program config) in a transaction signed by the
   *old* quorum. Verify the on-chain update is finalized.
3. **Switch config, one signer at a time.** Update
   `GCP_KMS_KEY_NAME`/`GCP_KMS_PUBLIC_KEY` (or AWS / HOT equivalents),
   redeploy, confirm the boot log prints the new signer pubkey and a
   test settlement/withdrawal finalizes.
4. **Deauthorize the old key.** Remove the old pubkey from the on-chain
   signer set; sweep any residual float to the treasury.
5. **Destroy.** Schedule KMS key destruction (or shred the encrypted
   keypair file + rotate `ORACLE_KEYPAIR_ENCRYPTION_KEY` for file-based
   environments). Record the rotation in the ops log with both pubkeys,
   timestamps, and the authorizing ticket.

## Emergency freeze (suspected compromise, minutes matter)

1. **Freeze outflows in-process:** the velocity guard freeze stops all
   platform-key sends (`SendSOL`, `SendSOLFrom`, batch payouts).
   Trigger via the admin/watchtower path; verify with a probe withdrawal
   (expect velocity/frozen rejection).
2. **Freeze user money movement:** watchtower auto-freeze engages on
   reconciliation deficits; manually set user flags for affected
   accounts (withdraw/P2P/claim all honour freeze).
3. **Revoke the key in KMS** (disable the key version) — signing stops
   even if the process is compromised.
4. **Rotate** per the procedure above with a fresh key; do not unfreeze
   until reconciliation (lamports-exact, all queues) is green for two
   consecutive runs.
5. **Post-incident:** preserve audit logs, journal, and on-chain
   signatures for the suspect window; compare `Σ wallets` vs
   `-Σ journal(2100+2110)` before resuming payouts.

## Freeze drill (staging, monthly)

- Set the velocity freeze; confirm withdrawals queue (202) and do not
  send; confirm queued rows remain in `queued` state.
- Unfreeze; confirm the worker drains the queue exactly once per row
  (check signatures recorded, no duplicate sends).
- Confirm auto-freeze fires by injecting a test deficit in staging
  reconciliation (two consecutive runs ⇒ watchtower freeze + alert).
