'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface Section {
  id: string;
  title: string;
  subsections?: { id: string; title: string }[];
}

const SECTIONS: Section[] = [
  { id: 'abstract', title: 'Abstract' },
  {
    id: 'problem-statement',
    title: '1. Problem Statement',
    subsections: [
      { id: 'centralized-cartels', title: '1.1 Centralized Proxy Cartels' },
      { id: 'proxyhubb-solution', title: '1.2 The ProxyHubb Solution' },
    ],
  },
  { id: 'architecture', title: '2. 5-Layer DePIN Architecture' },
  { id: 'smart-contracts', title: '3. Solana Anchor Core & PDAs' },
  {
    id: 'state-channels',
    title: '4. State-Channel Proof of Bandwidth',
    subsections: [
      { id: 'receipt-format', title: '4.1 Canonical Receipt Layout' },
      { id: 'precompile-verification', title: '4.2 Ed25519 Introspection' },
      { id: 'conservation-theorem', title: '4.3 Conservation Theorem' },
    ],
  },
  { id: 'zk-rollups', title: '5. Groth16 BN254 ZK Rollups' },
  { id: 'staked-gateways', title: '6. Staked Gateway Network' },
  { id: 'p2p-mesh', title: '7. Direct P2P WebRTC Mesh' },
  { id: 'tokenomics', title: '8. Tokenomics & Mining Pool' },
  { id: 'security-proofs', title: '9. Formal Threat Model & Fuzzing' },
  { id: 'benchmarks', title: '10. Empirical Benchmarks' },
  { id: 'conclusion', title: '11. Roadmap & Conclusion' },
  { id: 'references', title: '12. References' },
];

export function WhitepaperViewer() {
  const [activeSection, setActiveSection] = useState('abstract');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );

    SECTIONS.forEach((sec) => {
      const el = document.getElementById(sec.id);
      if (el) observer.observe(el);
      sec.subsections?.forEach((sub) => {
        const subEl = document.getElementById(sub.id);
        if (subEl) observer.observe(subEl);
      });
    });

    return () => observer.disconnect();
  }, []);

  const copyLink = (id: string) => {
    const url = `${window.location.origin}/whitepaper#${id}`;
    navigator.clipboard.writeText(url);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#090d16', color: '#f1f5f9', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top Header Bar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'rgba(9, 13, 22, 0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '16px 24px',
        }}
      >
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <Link href="/" style={{ textDecoration: 'none', color: '#10b981', fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.02em' }}>
              PROXYHUBB
            </Link>
            <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 600 }}>
              WHITEPAPER v2.0
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handlePrint}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#e2e8f0',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              📄 Print / Save PDF
            </button>
            <Link
              href="/depin"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#06281e',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: 700,
                textDecoration: 'none',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)',
              }}
            >
              ⚡ Live DePIN Portal
            </Link>
          </div>
        </div>
      </header>

      {/* Main Layout: Sidebar + Paper */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: '48px', padding: '40px 24px' }}>
        {/* Left Navigation Sidebar */}
        <aside
          style={{
            width: '280px',
            flexShrink: 0,
            position: 'sticky',
            top: '96px',
            height: 'calc(100vh - 120px)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingRight: '12px',
          }}
        >
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontWeight: 700, marginBottom: '8px' }}>
            Table of Contents
          </div>
          {SECTIONS.map((sec) => (
            <div key={sec.id}>
              <a
                href={`#${sec.id}`}
                style={{
                  display: 'block',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  textDecoration: 'none',
                  color: activeSection === sec.id ? '#10b981' : '#94a3b8',
                  background: activeSection === sec.id ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                  fontWeight: activeSection === sec.id ? 700 : 500,
                  transition: 'all 0.15s',
                }}
              >
                {sec.title}
              </a>
              {sec.subsections && (
                <div style={{ paddingLeft: '12px', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {sec.subsections.map((sub) => (
                    <a
                      key={sub.id}
                      href={`#${sub.id}`}
                      style={{
                        display: 'block',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        textDecoration: 'none',
                        color: activeSection === sub.id ? '#34d399' : '#64748b',
                        background: activeSection === sub.id ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      }}
                    >
                      {sub.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </aside>

        {/* Center Paper Content */}
        <main
          style={{
            flex: 1,
            maxWidth: '900px',
            background: 'rgba(15, 23, 42, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '48px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            lineHeight: 1.75,
          }}
        >
          {/* Document Title Header */}
          <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '32px', marginBottom: '40px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 12px', borderRadius: '999px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', fontSize: '0.8rem', fontWeight: 600, border: '1px solid rgba(56, 189, 248, 0.2)', marginBottom: '16px' }}>
              SOLANA DEPIN PROTOCOL SPECIFICATION
            </div>
            <h1 style={{ fontSize: '2.4rem', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.2, margin: '0 0 16px 0', color: '#ffffff' }}>
              ProxyHubb: High-Throughput Decentralized Physical Infrastructure Protocol for Zero-Knowledge Bandwidth Routing & State-Channel Settlement
            </h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.85rem', color: '#94a3b8' }}>
              <div><strong>Program ID:</strong> <code style={{ color: '#34d399', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px' }}>AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu</code></div>
              <div><strong>Version:</strong> 2.0.0 Production</div>
              <div><strong>Consensus:</strong> Solana Proof of History / PoS</div>
            </div>
          </div>

          {/* Section: Abstract */}
          <section id="abstract" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Abstract
              <button onClick={() => copyLink('abstract')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.8rem' }}>
                {copiedSection === 'abstract' ? '✓ Copied' : '🔗 Link'}
              </button>
            </h2>
            <p style={{ fontSize: '1.05rem', color: '#cbd5e1', fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '10px', borderLeft: '4px solid #10b981' }}>
              Centralized proxy networks represent a multi-billion-dollar market plagued by structural inefficiencies: custodial counterparty risk, opaque billing, unverified bandwidth counters, malicious traffic interception, and single points of failure. This paper presents <strong>ProxyHubb</strong>, a Decentralized Physical Infrastructure Network (DePIN) protocol that transforms residential and datacenter internet connections into a permissionless, cryptographically verifiable proxy routing marketplace on Solana.
            </p>
          </section>

          {/* Section: Problem Statement */}
          <section id="problem-statement" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              1. Problem Statement
            </h2>
            <p>
              The global proxy economy exceeds $2.8B annually, fueled by enterprise AI web data extraction, cybersecurity intelligence, and uncensored internet browsing. However, traditional Web2 proxy brokers operate as custodial gatekeepers extracting 85%–95% margins while denying users verifiable proof of delivery.
            </p>
            <div id="centralized-cartels" style={{ marginTop: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>1.1 Centralized Proxy Cartels</h3>
              <ul style={{ paddingLeft: '20px', color: '#94a3b8' }}>
                <li><strong>Custodial Lock-In:</strong> Buyers must prepay non-refundable fiat balances.</li>
                <li><strong>Unverifiable Counters:</strong> Providers are credited based on unauthenticated central server logs.</li>
                <li><strong>Surveillance & MITM:</strong> Centralized proxies act as single surveillance choke points.</li>
              </ul>
            </div>
            <div id="proxyhubb-solution" style={{ marginTop: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>1.2 The ProxyHubb Solution</h3>
              <p>
                ProxyHubb enforces non-custodial smart contract escrows on Solana, replaces trusted oracles with <strong>dual-signed Ed25519 state-channel micro-receipts</strong>, aggregates high-volume streams via <strong>Groth16 ZK rollups</strong>, and slashes misbehaving gateway relays algorithmically.
              </p>
            </div>
          </section>

          {/* Section: Architecture */}
          <section id="architecture" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              2. 5-Layer DePIN Architecture
            </h2>
            <div style={{ background: '#020617', padding: '24px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'monospace', fontSize: '0.85rem', color: '#38bdf8', overflowX: 'auto', marginBottom: '20px' }}>
              <div>[L5: Application]  Next.js 14 (/depin) • Chrome MV3 • Node/Python/Go SDKs</div>
              <div>      │</div>
              <div>[L4: Data Plane]   Direct P2P WebRTC (~14ms) • Staked Gateways (3128/8090) (~28ms)</div>
              <div>      │</div>
              <div>[L3: ZK Rollup]    BN254 Groth16 Batch Prover • Merkle State Channel Aggregation</div>
              <div>      │</div>
              <div>[L2: State Chan]   Bilateral Ed25519 Micro-Receipts • Sub-100μs Counter-Signing</div>
              <div>      │</div>
              <div>[L1: Settlement]   Solana Anchor Core • Non-Custodial Escrows • PoBW Mining Pool</div>
            </div>
          </section>

          {/* Section: Smart Contracts */}
          <section id="smart-contracts" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              3. Solana Anchor Smart Contracts & PDA Matrix
            </h2>
            <p>
              The core Anchor program exposes deterministic Program Derived Addresses (PDAs) with zero centralized admin key custody:
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginTop: '16px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: '#94a3b8' }}>
                    <th style={{ padding: '10px' }}>Account Struct</th>
                    <th style={{ padding: '10px' }}>Canonical PDA Seeds</th>
                    <th style={{ padding: '10px' }}>Purpose</th>
                  </tr>
                </thead>
                <tbody style={{ color: '#cbd5e1' }}>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '10px', color: '#38bdf8' }}><code>GatewayRegistry</code></td>
                    <td style={{ padding: '10px' }}><code>["gateway-registry", gateway_pubkey]</code></td>
                    <td style={{ padding: '10px' }}>1.0 SOL collateral bond & QoS telemetry</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '10px', color: '#38bdf8' }}><code>EpochRewardPool</code></td>
                    <td style={{ padding: '10px' }}><code>["epoch-rewards", epoch_id]</code></td>
                    <td style={{ padding: '10px' }}>Non-custodial PoBW mining emissions vault</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '10px', color: '#38bdf8' }}><code>Escrow</code></td>
                    <td style={{ padding: '10px' }}><code>["escrow", buyer, order_id]</code></td>
                    <td style={{ padding: '10px' }}>Locked buyer SOL for micro-receipt settlement</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '10px', color: '#38bdf8' }}><code>DepositVault</code></td>
                    <td style={{ padding: '10px' }}><code>["deposit_vault"]</code></td>
                    <td style={{ padding: '10px' }}>Prepaid buyer credit balance vault</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section: State Channels & Math Proof */}
          <section id="state-channels" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              4. Bilateral State Channels & Proof of Bandwidth (PoBW)
            </h2>
            <div id="receipt-format" style={{ marginTop: '16px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>4.1 Canonical Receipt Layout</h3>
              <pre style={{ background: '#020617', padding: '14px', borderRadius: '8px', color: '#34d399', fontSize: '0.85rem' }}>
receipt:v1:&lt;escrow_pda&gt;:&lt;buyer_pubkey&gt;:&lt;seller_pubkey&gt;:&lt;bytes_used&gt;:&lt;sequence_num&gt;
              </pre>
            </div>
            <div id="conservation-theorem" style={{ marginTop: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>4.3 Mathematical Conservation Theorem</h3>
              <p>
                Let <code>A</code> be escrow lamports, <code>L = limit_gb &times; 2^30</code> be total contracted bytes, <code>U</code> be verified bytes, and <code>C = min(U, L)</code>. The smart contract computes:
              </p>
              <div style={{ background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '16px', borderRadius: '8px', color: '#e2e8f0', margin: '16px 0', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                <div>seller_payout = floor((A * C) / L)</div>
                <div>buyer_refund  = A - seller_payout</div>
                <div style={{ marginTop: '8px', color: '#34d399', fontWeight: 700 }}>
                  Theorem 1 (Zero-Leak Balance Conservation): forall A, L, U in N ==&gt; seller_payout + buyer_refund === A
                </div>
              </div>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                Anchor's <code>close = buyer</code> constraint ensures all residual rent lamports plus <code>buyer_refund</code> are returned directly to the buyer's wallet, eliminating any possibility of locked dust or stranded funds.
              </p>
            </div>
          </section>

          {/* Section: ZK Rollups */}
          <section id="zk-rollups" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              5. Groth16 BN254 Zero-Knowledge Batch Rollups
            </h2>
            <p>
              For enterprise high-throughput scraping batches, state-channel leaves are rolled into a Merkle root and proven off-chain via Groth16 SNARKs. The 32-byte digest is reduced into the BN254 scalar field modulus <code>r</code>:
            </p>
            <div style={{ background: '#020617', padding: '16px', borderRadius: '8px', color: '#38bdf8', fontSize: '0.85rem', fontFamily: 'monospace' }}>
              r = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001<br/>
              public_input = SHA256(root || count || total_bytes || start || end || leaves_hash) mod r
            </div>
          </section>

          {/* Section: Staked Gateways */}
          <section id="staked-gateways" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              6. Permissionless Staked Gateway Operator Network
            </h2>
            <p>
              Third-party edge operators bond collateral (&ge; 1.0 SOL) via <code>register_gateway</code>. If an operator drops packets, tampers with TLS traffic, or goes offline, <code>slash_gateway</code> algorithmically confiscates collateral, routing penalties to the community treasury and deactivating the gateway when balance falls below minimum stake.
            </p>
          </section>

          {/* Section: Tokenomics */}
          <section id="tokenomics" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              8. Tokenomics &amp; Proof-of-Bandwidth Mining Pool
            </h2>
            <p>
              Residential providers earn proportional rewards from the on-chain <code>EpochRewardPool</code>:
            </p>
            <div style={{ background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.2)', padding: '16px', borderRadius: '8px', color: '#e2e8f0', margin: '16px 0', fontFamily: 'monospace', fontSize: '0.9rem' }}>
              <div>Reward_i = floor((B_i * E_k) / sum(B_j for j=1..M)) ==&gt; sum(Reward_i for i=1..M) &lt;= E_k</div>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
              This guarantees mathematical solvency: the emission pool can never experience an overdraw or run out of rewards.
            </p>
          </section>

          {/* Section: Formal Security */}
          <section id="security-proofs" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              9. Formal Threat Model & Adversarial Fuzzing Proofs
            </h2>
            <p>
              The protocol was evaluated across 25,000+ continuous randomized adversarial fuzz iterations (<code>testing/fuzz_adversarial_suite.ts</code>):
            </p>
            <ul style={{ paddingLeft: '20px', color: '#cbd5e1' }}>
              <li><strong>Zero-Leak Math Fuzzing:</strong> 25,000/25,000 iterations maintained exact lamport conservation.</li>
              <li><strong>Cryptographic Forgery Injections:</strong> 1,000/1,000 tampered signature injections rejected.</li>
              <li><strong>Concurrent Claim Solvency:</strong> 1,000 multi-provider epoch simulations verified with 0 overdraw.</li>
            </ul>
          </section>

          {/* Section: Conclusion */}
          <section id="conclusion" style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              11. Roadmap & Conclusion
            </h2>
            <p>
              ProxyHubb delivers a production-grade, decentralized alternative to the broken Web2 proxy oligopoly. With state-channel settlements, Groth16 batch rollups, staked relays, and sub-15ms direct P2P routing, ProxyHubb is ready for global enterprise adoption on Solana Mainnet-Beta.
            </p>
          </section>

          {/* Section: References */}
          <section id="references">
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
              12. References
            </h2>
            <ol style={{ paddingLeft: '20px', color: '#94a3b8', fontSize: '0.85rem' }}>
              <li>Yakovenko, A. (2018). <em>Solana: A new architecture for a high performance blockchain v0.8.13.</em></li>
              <li>Groth, J. (2016). <em>On the Size of Pairing-based Non-interactive Arguments.</em> EUROCRYPT 2016.</li>
              <li>Poon, J., &amp; Dryja, T. (2016). <em>The Bitcoin Lightning Network: Scalable Off-Chain Instant Payments.</em></li>
              <li>Rescorla, E. (2018). <em>The Transport Layer Security (TLS) Protocol Version 1.3.</em> RFC 8446.</li>
              <li>Rosenberg, J., et al. (2018). <em>Interactive Connectivity Establishment (ICE).</em> RFC 8445.</li>
            </ol>
          </section>
        </main>
      </div>
    </div>
  );
}
