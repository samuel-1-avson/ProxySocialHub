# Settle + withdraw prove — 20260808T214557Z

## RPC
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
SOLANA_RPC_ENDPOINTS=https://api.devnet.solana.com,https://solana-devnet.api.onfinality.io/public

## Steps
=== escrow buy+release (settle) ===
time="2026-08-08T21:45:59Z" level=warning msg="The \"COINGECKO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:45:59Z" level=warning msg="The \"COINMARKETCAP_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:45:59Z" level=warning msg="The \"PHB_TOKEN_MINT\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:45:59Z" level=warning msg="The \"COINGECKO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:45:59Z" level=warning msg="The \"COINMARKETCAP_API_KEY\" variable is not set. Defaulting to a blank string."
seller_wallet=62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE orig_buyer_wallet=8CS9E2HZk1hpQSXNxEcm23suy1vVoEK2Yw3MkH5pSGhW
=== GENERATE BUYER KEYPAIR ===
buyer_pub=7dyrwnjKhohjZU5qxJgnaybPZzawzamTyCa3oJF6Qs52
=== FUND BUYER (SM funder keypair preferred; airdrop fallback) ===
funder=local_oracle_file
Server responded with 429 Too Many Requests.  Retrying after 500ms delay...
Server responded with 429 Too Many Requests.  Retrying after 1000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 2000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 4000ms delay...
getBalance attempt 1/8: failed to get balance of account 7dyrwnjKhohjZU5qxJgnaybPZzawzamTyCa3oJF6Qs52: Error: 429 Too Many Requests:  {"jsonrpc":"2.0","error":{"code": 429, "message":"Connection rate limi
Server responded with 429 Too Many Requests.  Retrying after 500ms delay...
Server responded with 429 Too Many Requests.  Retrying after 1000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 2000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 4000ms delay...
getBalance attempt 2/8: failed to get balance of account 7dyrwnjKhohjZU5qxJgnaybPZzawzamTyCa3oJF6Qs52: Error: 429 Too Many Requests:  {"jsonrpc":"2.0","error":{"code": 429, "message":"Connection rate limi
Server responded with 429 Too Many Requests.  Retrying after 500ms delay...
Server responded with 429 Too Many Requests.  Retrying after 1000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 2000ms delay...
Server responded with 429 Too Many Requests.  Retrying after 4000ms delay...
getBalance attempt 3/8: failed to get balance of account 7dyrwnjKhohjZU5qxJgnaybPZzawzamTyCa3oJF6Qs52: Error: 429 Too Many Requests:  {"jsonrpc":"2.0","error":{"code": 429, "message":"Connection rate limi
funded_via_keypair 7dyrwnjKhohjZU5qxJgnaybPZzawzamTyCa3oJF6Qs52 from 8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4 bal_before 0 3VV2SF69ou3pbFNUXPGzGXMP2mumGmRwgRZbpZ4T2SvbonmooK9AbvL8yyuQHcV5cYfdo5y5KzrDjjYuMwGMusHe
{"buyer":"7dyrwnjKhohjZU5qxJgnaybPZzawzamTyCa3oJF6Qs52","balance_lamports":80000000}
time="2026-08-08T21:46:44Z" level=warning msg="The \"PHB_TOKEN_MINT\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:46:44Z" level=warning msg="The \"COINGECKO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:46:44Z" level=warning msg="The \"COINMARKETCAP_API_KEY\" variable is not set. Defaulting to a blank string."
UPDATE 1
time="2026-08-08T21:46:45Z" level=warning msg="The \"COINGECKO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:46:45Z" level=warning msg="The \"COINMARKETCAP_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:46:45Z" level=warning msg="The \"PHB_TOKEN_MINT\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:46:45Z" level=warning msg="The \"COINGECKO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:46:45Z" level=warning msg="The \"COINMARKETCAP_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:46:45Z" level=warning msg="The \"PHB_TOKEN_MINT\" variable is not set. Defaulting to a blank string."
INSERT 0 1
time="2026-08-08T21:46:45Z" level=warning msg="The \"COINGECKO_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:46:45Z" level=warning msg="The \"COINMARKETCAP_API_KEY\" variable is not set. Defaulting to a blank string."
time="2026-08-08T21:46:45Z" level=warning msg="The \"PHB_TOKEN_MINT\" variable is not set. Defaulting to a blank string."
=== CREATE ORDER ===
create HTTP=201 body={"order":{"id":"9e9f3569-fa61-4ed1-be5e-8a6fe6914dea","buyer_id":"76609a25-0b69-4e05-9640-4c67d7a07f36","seller_id":"b77e84c9-0e85-4f23-afc0-581cd561c216","listing_id":"c1472dbc-dee3-407e-8fea-ec3ed42489ac","bandwidth_gb":1,"price_per_gb":0.99,"total_price":0.99,"status":"pending","session_id":"b082de6f-28ea-456f-b4e0-62083969bb8e","bandwidth_limit_gb":1,"created_at":"2026-08-08T21:46:46.065476Z","updated_at":"2026-08-08T21:46:46.090877Z","buyer":{"id":"76609a25-0b69-4e05-9640-4c67d7a07f36","email":"8CS9E2HZk1hpQSXNxEcm23suy1vVoEK2Yw3MkH5pSGhW@wallet.proxyhubb.com","role":"buyer","status":"act
oid=9e9f3569-fa61-4ed1-be5e-8a6fe6914dea
=== PAY/SOLANA ===
curl: (52) Empty reply from server
=== CLEANUP ===
KEEP_ORDER oid=9e9f3569-fa61-4ed1-be5e-8a6fe6914dea
KEEP_LISTING id=c1472dbc-dee3-407e-8fea-ec3ed42489ac
skip soft-delete NODE_ID=4b60f9e2-11dc-4240-a332-6ec9f3669379 (SKIP_NODE_SOFT_DELETE=1)
- FAIL: escrow smoke rc=52
=== compensation outbox peek ===
 id | kind | status | attempt_count | err | updated_at 
----+------+--------+---------------+-----+------------
(0 rows)

=== withdraw smoke ===
withdraw attempt 1 HTTP=000000 body={"amount_sol":0.01,"destination":"62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE","new_balance":15.409956447,"solscan_url":"https://solscan.io/tx/VeGxFCZzNmBJHmUXUskfGvGEusfNUbD4TLCo2Yg5H8MUY1FJNjUwc2y2EtuvGqqkcCCtEabmqHvjw
withdraw attempt 2 HTTP=000000 body={"amount_sol":0.01,"destination":"62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE","new_balance":15.409956447,"solscan_url":"https://solscan.io/tx/VeGxFCZzNmBJHmUXUskfGvGEusfNUbD4TLCo2Yg5H8MUY1FJNjUwc2y2EtuvGqqkcCCtEabmqHvjw
withdraw attempt 3 HTTP=000000 body={"amount_sol":0.01,"destination":"62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE","new_balance":15.409956447,"solscan_url":"https://solscan.io/tx/VeGxFCZzNmBJHmUXUskfGvGEusfNUbD4TLCo2Yg5H8MUY1FJNjUwc2y2EtuvGqqkcCCtEabmqHvjw
withdraw attempt 4 HTTP=000000 body={"amount_sol":0.01,"destination":"62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE","new_balance":15.409956447,"solscan_url":"https://solscan.io/tx/VeGxFCZzNmBJHmUXUskfGvGEusfNUbD4TLCo2Yg5H8MUY1FJNjUwc2y2EtuvGqqkcCCtEabmqHvjw
withdraw attempt 5 HTTP=000000 body={"amount_sol":0.01,"destination":"62vwX11TCForSbpExYz7sp2b6AkWy7urDgYHcERt2eE","new_balance":15.409956447,"solscan_url":"https://solscan.io/tx/VeGxFCZzNmBJHmUXUskfGvGEusfNUbD4TLCo2Yg5H8MUY1FJNjUwc2y2EtuvGqqkcCCtEabmqHvjw
- FAIL: withdraw HTTP=000000

## Summary
PASS=0 FAIL=2
VERDICT=PARTIAL
