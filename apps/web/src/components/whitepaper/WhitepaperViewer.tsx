"use client";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { Printer } from "lucide-react";
export function WhitepaperViewer() {
  return (
    <div className="whitepaper-page">
      <MarketingHeader />
      <main id="main-content" tabIndex={-1}>
        <header className="whitepaper-heading">
          <div>
            <p className="ui-eyebrow">Research & proposed architecture</p>
            <h1>Architecture draft</h1>
            <p>
              A reading copy of the proposed network design. Implementation and
              deployment evidence must be evaluated separately.
            </p>
          </div>
          <button
            type="button"
            className="ui-button secondary"
            onClick={() => window.print()}
          >
            <Printer size={16} />
            Print / Save PDF
          </button>
        </header>
        <aside className="workflow-note" role="note">
          Draft architecture only. ZK proofs, state channels, mining rewards,
          staking, and decentralized routing described below are proposals.
          These notes do not establish product availability or independently
          verified performance.
        </aside>
        <div className="whitepaper-layout">
          <nav aria-label="Architecture draft contents">
            <p className="ui-eyebrow">On this page</p>
            <a href="#abstract">Abstract</a>
            <a href="#problem-statement">1. Problem Statement</a>
            <a href="#architecture">2. 5-Layer DePIN Architecture</a>
            <a href="#smart-contracts">
              3. Solana Anchor Smart Contracts & PDA Matrix
            </a>
            <a href="#state-channels">
              4. Bilateral State Channels & Proof of Bandwidth (PoBW)
            </a>
            <a href="#zk-rollups">
              5. Groth16 BN254 Zero-Knowledge Batch Rollups
            </a>
            <a href="#staked-gateways">
              6. Permissionless Staked Gateway Operator Network
            </a>
            <a href="#tokenomics">
              8. Tokenomics &amp; Proof-of-Bandwidth Mining Pool
            </a>
            <a href="#security-proofs">
              9. Formal Threat Model & Adversarial Fuzzing Proofs
            </a>
            <a href="#conclusion">11. Roadmap & Conclusion</a>
            <a href="#references">12. References</a>
          </nav>
          <article className="whitepaper-document ui-surface">
            <section id="abstract">
              <h2>Abstract</h2>
              <p>
                Centralized proxy networks represent a multi-billion-dollar
                market plagued by structural inefficiencies: custodial
                counterparty risk, opaque billing, unverified bandwidth
                counters, malicious traffic interception, and single points of
                failure. This paper presents <strong>ProxyHubb</strong>, a
                Decentralized Physical Infrastructure Network (DePIN) protocol
                that transforms residential and datacenter internet connections
                into a permissionless, cryptographically verifiable proxy
                routing marketplace on Solana.
              </p>
            </section>

            {/* Section: Problem Statement */}
            <section id="problem-statement">
              <h2>1. Problem Statement</h2>
              <p>
                The global proxy economy exceeds $2.8B annually, fueled by
                enterprise AI web data extraction, cybersecurity intelligence,
                and uncensored internet browsing. However, traditional Web2
                proxy brokers operate as custodial gatekeepers extracting
                85%–95% margins while denying users verifiable proof of
                delivery.
              </p>
              <div id="centralized-cartels">
                <h3>1.1 Centralized Proxy Cartels</h3>
                <ul>
                  <li>
                    <strong>Custodial Lock-In:</strong> Buyers must prepay
                    non-refundable fiat balances.
                  </li>
                  <li>
                    <strong>Unverifiable Counters:</strong> Providers are
                    credited based on unauthenticated central server logs.
                  </li>
                  <li>
                    <strong>Surveillance & MITM:</strong> Centralized proxies
                    act as single surveillance choke points.
                  </li>
                </ul>
              </div>
              <div id="proxyhubb-solution">
                <h3>1.2 The ProxyHubb Solution</h3>
                <p>
                  ProxyHubb enforces non-custodial smart contract escrows on
                  Solana, replaces trusted oracles with{" "}
                  <strong>
                    dual-signed Ed25519 state-channel micro-receipts
                  </strong>
                  , aggregates high-volume streams via{" "}
                  <strong>Groth16 ZK rollups</strong>, and slashes misbehaving
                  gateway relays algorithmically.
                </p>
              </div>
            </section>

            {/* Section: Architecture */}
            <section id="architecture">
              <h2>2. 5-Layer DePIN Architecture</h2>
              <div>
                <div>
                  [L5: Application] Next.js 14 (/depin) • Chrome MV3 •
                  Node/Python/Go SDKs
                </div>
                <div> │</div>
                <div>
                  [L4: Data Plane] Direct P2P WebRTC (~14ms) • Staked Gateways
                  (3128/8090) (~28ms)
                </div>
                <div> │</div>
                <div>
                  [L3: ZK Rollup] BN254 Groth16 Batch Prover • Merkle State
                  Channel Aggregation
                </div>
                <div> │</div>
                <div>
                  [L2: State Chan] Bilateral Ed25519 Micro-Receipts • Sub-100μs
                  Counter-Signing
                </div>
                <div> │</div>
                <div>
                  [L1: Settlement] Solana Anchor Core • Non-Custodial Escrows •
                  PoBW Mining Pool
                </div>
              </div>
            </section>

            {/* Section: Smart Contracts */}
            <section id="smart-contracts">
              <h2>3. Solana Anchor Smart Contracts & PDA Matrix</h2>
              <p>
                The core Anchor program exposes deterministic Program Derived
                Addresses (PDAs) with zero centralized admin key custody:
              </p>
              <div>
                <table>
                  <thead>
                    <tr>
                      <th>Account Struct</th>
                      <th>Canonical PDA Seeds</th>
                      <th>Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <code>GatewayRegistry</code>
                      </td>
                      <td>
                        <code>
                          [&quot;gateway-registry&quot;, gateway_pubkey]
                        </code>
                      </td>
                      <td>1.0 SOL collateral bond & QoS telemetry</td>
                    </tr>
                    <tr>
                      <td>
                        <code>EpochRewardPool</code>
                      </td>
                      <td>
                        <code>[&quot;epoch-rewards&quot;, epoch_id]</code>
                      </td>
                      <td>Non-custodial PoBW mining emissions vault</td>
                    </tr>
                    <tr>
                      <td>
                        <code>Escrow</code>
                      </td>
                      <td>
                        <code>[&quot;escrow&quot;, buyer, order_id]</code>
                      </td>
                      <td>Locked buyer SOL for micro-receipt settlement</td>
                    </tr>
                    <tr>
                      <td>
                        <code>DepositVault</code>
                      </td>
                      <td>
                        <code>[&quot;deposit_vault&quot;]</code>
                      </td>
                      <td>Prepaid buyer credit balance vault</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Section: State Channels & Math Proof */}
            <section id="state-channels">
              <h2>4. Bilateral State Channels & Proof of Bandwidth (PoBW)</h2>
              <div id="receipt-format">
                <h3>4.1 Canonical Receipt Layout</h3>
                <pre tabIndex={0} aria-label="Canonical receipt layout">
                  receipt:v1:&lt;escrow_pda&gt;:&lt;buyer_pubkey&gt;:&lt;seller_pubkey&gt;:&lt;bytes_used&gt;:&lt;sequence_num&gt;
                </pre>
              </div>
              <div id="conservation-theorem">
                <h3>4.3 Mathematical Conservation Theorem</h3>
                <p>
                  Let <code>A</code> be escrow lamports,{" "}
                  <code>L = limit_gb &times; 2^30</code> be total contracted
                  bytes, <code>U</code> be verified bytes, and{" "}
                  <code>C = min(U, L)</code>. The smart contract computes:
                </p>
                <div>
                  <div>seller_payout = floor((A * C) / L)</div>
                  <div>buyer_refund = A - seller_payout</div>
                  <div>
                    Theorem 1 (Zero-Leak Balance Conservation): forall A, L, U
                    in N ==&gt; seller_payout + buyer_refund === A
                  </div>
                </div>
                <p>
                  Anchor&#39;s <code>close = buyer</code> constraint ensures all
                  residual rent lamports plus <code>buyer_refund</code> are
                  returned directly to the buyer&#39;s wallet, eliminating any
                  possibility of locked dust or stranded funds.
                </p>
              </div>
            </section>

            {/* Section: ZK Rollups */}
            <section id="zk-rollups">
              <h2>5. Groth16 BN254 Zero-Knowledge Batch Rollups</h2>
              <p>
                For enterprise high-throughput scraping batches, state-channel
                leaves are rolled into a Merkle root and proven off-chain via
                Groth16 SNARKs. The 32-byte digest is reduced into the BN254
                scalar field modulus <code>r</code>:
              </p>
              <div>
                r =
                0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
                <br />
                public_input = SHA256(root || count || total_bytes || start ||
                end || leaves_hash) mod r
              </div>
            </section>

            {/* Section: Staked Gateways */}
            <section id="staked-gateways">
              <h2>6. Permissionless Staked Gateway Operator Network</h2>
              <p>
                Third-party edge operators bond collateral (&ge; 1.0 SOL) via{" "}
                <code>register_gateway</code>. If an operator drops packets,
                tampers with TLS traffic, or goes offline,{" "}
                <code>slash_gateway</code> algorithmically confiscates
                collateral, routing penalties to the community treasury and
                deactivating the gateway when balance falls below minimum stake.
              </p>
            </section>

            {/* Section: Tokenomics */}
            <section id="tokenomics">
              <h2>8. Tokenomics &amp; Proof-of-Bandwidth Mining Pool</h2>
              <p>
                Residential providers earn proportional rewards from the
                on-chain <code>EpochRewardPool</code>:
              </p>
              <div>
                <div>
                  Reward_i = floor((B_i * E_k) / sum(B_j for j=1..M)) ==&gt;
                  sum(Reward_i for i=1..M) &lt;= E_k
                </div>
              </div>
              <p>
                This guarantees mathematical solvency: the emission pool can
                never experience an overdraw or run out of rewards.
              </p>
            </section>

            {/* Section: Formal Security */}
            <section id="security-proofs">
              <h2>9. Formal Threat Model & Adversarial Fuzzing Proofs</h2>
              <p>
                The draft requires reproducible security validation before these
                designs can be accepted. No independent validation artifacts are
                provided on this page.
              </p>
              <ul>
                <li>
                  Verify exact lamport conservation under adversarial inputs.
                </li>
                <li>Reject malformed and tampered signatures.</li>
                <li>Test concurrent claims and reward pool solvency.</li>
              </ul>
            </section>

            {/* Section: Conclusion */}
            <section id="conclusion">
              <h2>11. Roadmap & Conclusion</h2>
              <p>
                These notes describe a proposed architecture. Availability,
                security properties, and performance require implementation
                evidence, reproducible measurements, and deployment-specific
                acceptance. Use the protocol overview for the current product
                status.
              </p>
            </section>

            {/* Section: References */}
            <section id="references">
              <h2>12. References</h2>
              <ol>
                <li>
                  Yakovenko, A. (2018).{" "}
                  <em>
                    Solana: A new architecture for a high performance blockchain
                    v0.8.13.
                  </em>
                </li>
                <li>
                  Groth, J. (2016).{" "}
                  <em>
                    On the Size of Pairing-based Non-interactive Arguments.
                  </em>{" "}
                  EUROCRYPT 2016.
                </li>
                <li>
                  Poon, J., &amp; Dryja, T. (2016).{" "}
                  <em>
                    The Bitcoin Lightning Network: Scalable Off-Chain Instant
                    Payments.
                  </em>
                </li>
                <li>
                  Rescorla, E. (2018).{" "}
                  <em>
                    The Transport Layer Security (TLS) Protocol Version 1.3.
                  </em>{" "}
                  RFC 8446.
                </li>
                <li>
                  Rosenberg, J., et al. (2018).{" "}
                  <em>Interactive Connectivity Establishment (ICE).</em> RFC
                  8445.
                </li>
              </ol>
            </section>
          </article>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
