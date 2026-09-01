# ProxyHubb DePIN Protocol: Threat Model & Security Audit Specifications

This document outlines the formal threat model, adversarial vectors, mathematical invariant proofs, and defensive mechanisms implemented across the **ProxyHubb DePIN Protocol**.

---

## 1. Threat Model & Adversary Capabilities

| Threat Actor | Capabilities | Target Asset | Primary Mitigation |
|---|---|---|---|
| **Malicious Buyer** | Forges receipt sequence numbers, attempts replaying old receipts, refuses to sign receipts | Escrow SOL / Provider Bandwidth | Monotonic sequence counters, 24h escrow timeout, zero-leak conservation math |
| **Malicious Provider** | Falsifies byte counter in receipts, drops traffic, colludes with fake buyers | Buyer Escrow Funds | Dual-signature verification (`Ed25519SigVerify`), client-side counter-signing |
| **Malicious Gateway** | Man-in-the-middle (MITM) inspection, modifies TLS traffic, fabricates metrics | Buyer Data & Privacy | End-to-end TLS / WebRTC DataChannel encryption, bonded stake slashing (`slash_gateway`) |
| **Sybil Node Operator** | Spins up fake nodes, attempts draining the mining emission pool | Epoch Reward Pool ($PROXY) | Proof-of-Bandwidth verification tied to cryptographically settled mutual receipts |

---

## 2. Cryptographic & Mathematical Security Invariants

### 2.1. Invariant 1: Zero-Leak Conservation Law
For any escrow settlement involving amount $A$, bandwidth limit $L > 0$, and bytes used $U \ge 0$:
$$\text{seller\_payout} = \left\lfloor \frac{A \times \min(U, L)}{L} \right\rfloor$$
$$\text{buyer\_refund} = A - \text{seller\_payout}$$
$$\forall (A, U, L) \in \mathbb{N}^3, \quad \text{seller\_payout} + \text{buyer\_refund} \equiv A$$
* **Proof:** Because $\min(U, L) \le L$, the quotient is strictly bounded $\le A$. Subtraction guarantees exact balance conservation with zero leaked or minted lamports.

---

### 2.2. Invariant 2: Staked Gateway Solvency & Auto-Deactivation
Let $S_0$ be the initial bonded stake, $S_{\min}$ be the minimum stake threshold (1.0 SOL), and $P$ be the slash penalty:
$$S_{\text{remaining}} = S_0 - P$$
$$\text{is\_active} = \begin{cases} \text{true} & \text{if } S_{\text{remaining}} \ge S_{\min} \\ \text{false} & \text{if } S_{\text{remaining}} < S_{\min} \end{cases}$$
* **Proof:** If an operator's collateral is degraded below $S_{\min}$, the smart contract instantly sets `is_active = false`, excluding the gateway from discovery and routing.

---

### 2.3. Invariant 3: Proof-of-Bandwidth Mining Pool Solvency
For an epoch with total emission $E$, total verified bandwidth $B$, and $N$ providers with verified bandwidth $b_1, b_2, \dots, b_N$ where $\sum_{i=1}^N b_i = B$:
$$\text{reward}_i = \left\lfloor \frac{b_i \times E}{B} \right\rfloor$$
$$\sum_{i=1}^N \text{reward}_i = \sum_{i=1}^N \left\lfloor \frac{b_i \times E}{B} \right\rfloor \le \frac{\sum_{i=1}^N b_i \times E}{B} = \frac{B \times E}{B} = E$$
* **Proof:** By properties of the floor function, the sum of individual integer rewards is strictly $\le E$, guaranteeing the emission pool is never overdrawn under any sequence or concurrency of claims.

---

## 3. Defense-in-Depth Mechanisms

1. **Native Solana Ed25519 Introspection:** Direct verification via the Ed25519 precompile instruction (`Ed25519SigVerify111111111111111111111111111`) consumes minimal compute units and prevents signature malleability.
2. **Deterministic Canonical Messages:** Receipts and Announcements use fixed prefix versioning (`receipt:v1:...`, `PROXYHUB_P2P_ANNOUNCEMENT:v1:...`) preventing cross-protocol replay attacks.
3. **Fail-Closed Governance Gates:** In `enforce` mode, missing hotkeys, stale heartbeats, or unbonded operators immediately fail closed.
