# Settle + withdraw prove — 20260808T212340Z

## RPC
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
SOLANA_RPC_ENDPOINTS=https://api.devnet.solana.com,https://solana-devnet.api.onfinality.io/public

## Steps
=== escrow buy+release (settle) ===
time="2026-08-08T21:25:13Z" level=warning msg="The \"COINGECKO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:25:13Z" level=warning msg="The \"COINMARKETCAP_API_KEY\" variable is not set. Defaulting to a blank string."
INSERT 0 1
time="2026-08-08T21:25:14Z" level=warning msg="The \"PHB_TOKEN_MINT\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:25:14Z" level=warning msg="The \"COINGECKO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:25:14Z" level=warning msg="The \"COINMARKETCAP_API_KEY\" variable is not set. Defaulting to a blank string."
=== CREATE ORDER ===
create HTTP=201 body={"order":{"id":"834c182a-3346-4d93-9cd5-7e1c3bdeb61f","buyer_id":"76609a25-0b69-4e05-9640-4c67d7a07f36","seller_id":"b77e84c9-0e85-4f23-afc0-581cd561c216","listing_id":"c1472dbc-dee3-407e-8fea-ec3ed42489ac","bandwidth_gb":1,"price_per_gb":0.99,"total_price":0.99,"status":"pending","session_id":"02b7c6cc-de68-4225-a57f-accf065c4ea6","bandwidth_limit_gb":1,"created_at":"2026-08-08T21:25:14.577472Z","updated_at":"2026-08-08T21:25:14.603421Z","buyer":{"id":"76609a25-0b69-4e05-9640-4c67d7a07f36","email":"8CS9E2HZk1hpQSXNxEcm23suy1vVoEK2Yw3MkH5pSGhW@wallet.proxyhubb.com","role":"buyer","status":"act
oid=834c182a-3346-4d93-9cd5-7e1c3bdeb61f
=== PAY/SOLANA ===
pay HTTP=200 body={"amount_lamports":12980202,"amount_sol":0.012980201914252,"bandwidth_gb":1,"buyer_pubkey":"BW2uHF6gf8B2QPbccU9jT1fwzzFM4GwxVD55br9nQktg","escrow_already_funded":false,"escrow_expires_at":0,"escrow_pda":"35toa9d7eVqSUtEVFJeANjCZ79gEf5yPGcwLGQ1762xa","escrow_seed_kind":"legacy","on_chain_escrow_status":"","oracle_pubkey":"8P4uuapgGfW8L7VvdQJ9W7RpJqpfyifhPx9UQaHnKii2","program_id":"AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu","seller_pubkey":"62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE"}
amount_lamports=12980202 pda=35toa9d7eVqSUtEVFJeANjCZ79gEf5yPGcwLGQ1762xa
=== ON-CHAIN INIT ESCROW ===
funder=local_oracle_file
Server responded with 429 Too Many Requests.  Retrying after 500ms delay...
Server responded with 429 Too Many Requests.  Retrying after 1000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 2000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 4000ms delay...
getBalance attempt 1/8: failed to get balance of account BW2uHF6gf8B2QPbccU9jT1fwzzFM4GwxVD55br9nQktg: Error: 429 Too Many Requests:  {"jsonrpc":"2.0","error":{"code": 429, "message":"Connection rate limi
Server responded with 429 Too Many Requests.  Retrying after 500ms delay...
Server responded with 429 Too Many Requests.  Retrying after 1000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 2000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 4000ms delay...
buyer already funded BW2uHF6gf8B2QPbccU9jT1fwzzFM4GwxVD55br9nQktg bal 80000000
{"tx":"4opAJxTjQDXSxZY4oW3QXbxy7BaQdVo3txinAoarRNWJLrC7452Tx4Hnh3qLS3NGe2AfMmiuxtDy5YfwvLdRctYY","escrow_pda":"35toa9d7eVqSUtEVFJeANjCZ79gEf5yPGcwLGQ1762xa","buyer":"BW2uHF6gf8B2QPbccU9jT1fwzzFM4GwxVD55br9nQktg","amount_lamports":"12980202"}
init_tx=4opAJxTjQDXSxZY4oW3QXbxy7BaQdVo3txinAoarRNWJLrC7452Tx4Hnh3qLS3NGe2AfMmiuxtDy5YfwvLdRctYY
=== CONFIRM-ESCROW ===
confirm attempt 1 HTTP=409 body={"code":"escrow_missing","error":"On-chain escrow not found. Approve the wallet initializeEscrow transaction, then try again.","escrow_pda":"35toa9d7eVqSUtEVFJeANjCZ79gEf5yPGcwLGQ1762xa"}
confirm attempt 2 HTTP=200 body={"already_active":false,"amount_lamports":12980202,"escrow_pda":"35toa9d7eVqSUtEVFJeANjCZ79gEf5yPGcwLGQ1762xa","on_chain_status":"Pending","order":{"id":"834c182a-3346-4d93-9cd5-7e1c3bdeb61f","buyer_id":"76609a25-0b69-4e05-9640-4c67d7a07f36","seller_id":"b77e84c9-0e85-4f23-afc0-581cd561c216","listing_id":"c1472dbc-dee3-407e-8fea-ec3ed42489ac","bandwidth_gb":1,"price_per_gb":0.99,"total_price":0.99
=== CREDENTIALS (HOLD_RELEASE) ===
credentials attempt 1 HTTP=200
credentials_user=a44a***
=== CONNECT via edge :8090 ===
connect_http=200
CONNECT_OK
=== RELEASE ===
release HTTP=202 body={"code":"escrow_settle_queued","details":"failed to get recent blockhash: (*jsonrpc.RPCError)(0xf8d848140c0)({\n Code: (int) 429,\n Message: (string) (len=31) \"Connection rate limits exceeded\",\n Data: (interface {}) \u003cnil\u003e\n})\n","error":"on-chain settlement failed; queued for retry","order_id":"834c182a-3346-4d93-9cd5-7e1c3bdeb61f","status":"settle_queued"}
time="2026-08-08T21:26:00Z" level=warning msg="The \"PHB_TOKEN_MINT\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:26:00Z" level=warning msg="The \"COINGECKO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:26:00Z" level=warning msg="The \"COINMARKETCAP_API_KEY\" variable is not set. Defaulting to a blank string."
                  id                  | status |                  escrow_pda                  | payment_method 
--------------------------------------+--------+----------------------------------------------+----------------
 834c182a-3346-4d93-9cd5-7e1c3bdeb61f | active | 35toa9d7eVqSUtEVFJeANjCZ79gEf5yPGcwLGQ1762xa | solana_escrow
(1 row)

CONFIRM_OK
RELEASE_SOFT_FAIL {'code': 'escrow_settle_queued', 'details': 'failed to get recent blockhash: (*jsonrpc.RPCError)(0xf8d848140c0)({\n Code: (int) 429,\n Message: (string) (len=31) "Connection rate limits exceeded",\n Data: (interface {}) <nil>\n})\n', 'error': 'on-chain settlement failed; queued for retry', 'order_id': '834c182a-3346-4d93-9cd5-7e1c3bdeb61f', 'status': 'settle_queued'}
MARKETPLACE_ESCROW_BUY_SMOKE_DONE
=== CLEANUP ===
skip soft-delete NODE_ID=4b60f9e2-11dc-4240-a332-6ec9f3669379 (SKIP_NODE_SOFT_DELETE=1)
- FAIL: settle still queued (RPC)
=== compensation outbox peek ===
=== withdraw smoke ===
withdraw attempt 1 HTTP=503 body={"error":"Unable to verify treasury payout balance. Try again shortly."}
withdraw attempt 2 HTTP=200 body={"amount_sol":0.01,"destination":"62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE","new_balance":15.409956447,"solscan_url":"https://solscan.io/tx/VeGxFCZzNmBJHmUXUskfGvGEusfNUbD4TLCo2Yg5H8MUY1FJNjUwc2y2EtuvGqqkcCCtEabmqHvjw
- PASS: withdraw HTTP=200

## Summary
PASS=1 FAIL=1
VERDICT=PARTIAL
