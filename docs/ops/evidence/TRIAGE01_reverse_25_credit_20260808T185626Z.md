# TRIAGE-01 reverse +25 deposit credit — 20260808T185626Z

| Field | Value |
|-------|-------|
| Wallet | `fe793802-7249-423c-a502-780b6a5d48f8` |
| Lamports reversed | `25000000000` (25 SOL) |
| On-chain vault | unchanged (keep reserve) |
| Source tx | `2iFdcMXRYj4N9uENKu3agJF1piHAZWToCdG74hJRRnG5ZDHqNMZEjZEceMHk1hQrGZicG2CN5Fg71JUnUEeXGpQW` |

## Before
```
                  id                  | balance_lamports |     sol      
--------------------------------------+------------------+--------------
 fe793802-7249-423c-a502-780b6a5d48f8 |      40419956447 | 40.419956447
(1 row)

 liab_lamports |   liab_sol   
---------------+--------------
   40419956447 | 40.419956447
(1 row)

```
=== applying reverse ===
BEGIN
                  id                  | balance_lamports 
--------------------------------------+------------------
 fe793802-7249-423c-a502-780b6a5d48f8 |      40419956447
(1 row)

DO
INSERT 0 1
UPDATE 1
INSERT 0 2
COMMIT
      k       | balance_lamports |     sol      
--------------+------------------+--------------
 wallet_after |      15419956447 | 15.419956447
(1 row)

     k      |  lamports   |     sol      
------------+-------------+--------------
 liab_after | 15419956447 | 15.419956447
(1 row)

     k      |          created_at           | amount_lamports |           type           |               reference_id                
------------+-------------------------------+-----------------+--------------------------+-------------------------------------------
 ledger_row | 2026-08-08 18:56:27.431427+00 |    -25000000000 | treasury_reserve_reclass | triage01-reserve-reclass-20260808T185626Z
(1 row)

    k    |                  id                  |        entry_type        |               external_ref                
---------+--------------------------------------+--------------------------+-------------------------------------------
 journal | cc193e3e-82c0-41a3-a154-cfd36136f69e | treasury_reserve_reclass | triage01-reserve-reclass-20260808T185626Z
(1 row)

       k       | account_code |              wallet_id               | amount_lamports 
---------------+--------------+--------------------------------------+-----------------
 journal_lines | 2100         | fe793802-7249-423c-a502-780b6a5d48f8 |     25000000000
 journal_lines | 4000         |                                      |    -25000000000
(2 rows)

=== security flag check ===
 column_name 
-------------
(0 rows)

     table_name     
--------------------
 security_anomalies
 user_flags
(2 rows)


## Expected recon after
- Vault on-chain: 31.01 SOL (unchanged)
- Hot: 7.22 SOL
- Combined: ~38.23 SOL
- Liabilities: prior 40.42 - 25 = ~15.42 SOL
- Status: SURPLUS ~22.8 SOL

## Verdict
**APPLIED** — internal credit reversed; vault reserve retained.
