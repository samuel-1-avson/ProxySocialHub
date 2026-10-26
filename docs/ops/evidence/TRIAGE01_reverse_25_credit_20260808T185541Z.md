# TRIAGE-01 reverse +25 deposit credit — 20260808T185541Z

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
