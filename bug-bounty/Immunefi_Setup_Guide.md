# ProxyHubb Immunefi Bug Bounty Setup Guide

**Platform:** Immunefi  
**Network:** Solana DevNet  
**Launch Date:** [TBD]  
**Duration:** 30 days initial, then ongoing  
**Total Bounty Pool:** $50,000 USDC

---

## Table of Contents
1. [Getting Started on Immunefi](#1-getting-started-on-immunefi)
2. [Program Configuration](#2-program-configuration)
3. [Scope Definition](#3-scope-definition)
4. [Reward Structure](#4-reward-structure)
5. [Rules of Engagement](#5-rules-of-engagement)
6. [Response Procedures](#6-response-procedures)
7. [Launch Checklist](#7-launch-checklist)
8. [Marketing & Promotion](#8-marketing--promotion)

---

## 1. Getting Started on Immunefi

### Step 1: Create Account
1. Visit https://immunefi.com
2. Click "Launch Bug Bounty"
3. Sign up with project email: security@proxyhubb.com
4. Complete KYC/verification process
5. Set up 2FA

### Step 2: Project Setup
```yaml
Project Name: ProxyHubb
Category: DeFi / Infrastructure
Blockchain: Solana
Website: https://proxyhubb.com
Documentation: https://docs.proxyhubb.com
Twitter: @ProxyHubb
Discord: https://discord.gg/proxyhubb
```

### Step 3: Fund Escrow
```bash
# Transfer USDC to Immunefi escrow
# Amount: $50,000 USDC
# Network: Ethereum (for escrow)
# Immunefi will provide wallet address
```

---

## 2. Program Configuration

### Basic Information
```json
{
  "project": {
    "name": "ProxyHubb",
    "description": "Decentralized residential proxy marketplace with trustless escrow",
    "logo": "[URL to logo]",
    "banner": "[URL to banner]"
  },
  "blockchain": {
    "chain": "Solana",
    "network": "devnet",
    "program_id": "2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7"
  },
  "contacts": {
    "primary": "security@proxyhubb.com",
    "pgp": "[Link to PGP key]",
    "discord": "#security channel"
  }
}
```

### Repository Access
```
Private Repository Access:
  - GitHub: [Organization invite]
  - Access Level: Read-only
  - Branches: audit-ready (frozen)
  
Documentation:
  - Architecture docs
  - Threat model
  - Test suite
  - Deployment guide
```

---

## 3. Scope Definition

### In Scope ✅

#### Smart Contracts (Solana)
| Contract | Address | Functionality |
|----------|---------|---------------|
| ProxyHub Program | `2yDRyTwh...mDd7` | Main program |
| MultiSig Oracle | `[PDA]` | Signature aggregation |
| Insurance Pool | `[PDA]` | Slashing protection |
| Price Oracle | `[PDA]` | Dynamic pricing |

#### Specific Functions
```rust
// Multi-Sig
initialize_multisig_oracle
add_oracle_signer
remove_oracle_signer
settle_escrow_multisig

// Escrow
initialize_escrow
settle_escrow
emergency_refund

// Jury
initiate_jury_dispute
cast_vote
execute_jury_verdict

// Emergency
emergency_pause
emergency_resume

// Insurance
contribute_insurance
slash_provider_insurance

// Pricing
update_prices
calculate_session_price
```

#### Backend API (Go)
| Endpoint | Risk Level |
|----------|-----------|
| `/v1/crypto/batch-settle` | Critical |
| `/v1/crypto/emergency-pause` | Critical |
| `/v1/linked-wallets` | High |
| `/v1/wallet/deposit/crypto` | High |
| `/v1/crypto/multisig-status` | Medium |

### Out of Scope ❌
```
Frontend Applications:
  - Web UI (Next.js)
  - Mobile apps
  - Browser extensions

Infrastructure:
  - Servers
  - Databases
  - CDN
  - DNS

Third-Party:
  - Solana runtime
  - Anchor framework
  - Wallet adapters
  - RPC providers

Social Engineering:
  - Phishing
  - Credential theft
  - Physical attacks

Previously Reported:
  - Known issues
  - Documented limitations
```

---

## 4. Reward Structure

### Severity Classification

| Severity | Impact | Reward Range | Example |
|----------|--------|--------------|---------|
| **Critical** | System compromise, fund theft | $10,000 - $50,000 | Bypass multi-sig, drain escrow |
| **High** | Significant functionality broken | $5,000 - $10,000 | Unauthorized settlement |
| **Medium** | Limited impact, workaround exists | $1,000 - $5,000 | Price manipulation |
| **Low** | Minor issues, informational | $250 - $1,000 | Documentation errors |

### Specific Rewards

#### Critical ($10,000 - $50,000)
```
$50,000: Bypass multi-sig oracle and execute unauthorized settlement
$40,000: Drain insurance pool or escrow funds
$30,000: Exploit to slash more than 10% of provider stake
$25,000: Unauthorized emergency pause trigger
$20,000: Bypass signature verification completely
$15,000: Replay attack on multi-sig settlement
$10,000: Critical logic error causing fund lock
```

#### High ($5,000 - $10,000)
```
$10,000: Manipulate jury vote outcome
$8,000:  Bypass price oracle rate limiting
$7,000:  Exploit settlement calculation error
$6,000:  Unauthorized admin function access
$5,000:  Bypass jury voting restrictions
```

#### Medium ($1,000 - $5,000)
```
$5,000: Price oracle stale price exploitation
$3,000: Economic attack on insurance pool
$2,000: Race condition in settlement
$1,000: Improper input validation
```

#### Low ($250 - $1,000)
```
$1,000: Missing event emission
$500:  Gas optimization suggestion
$250:  Documentation inconsistency
```

### Bonus Rewards
```
+20%: Detailed write-up with PoC
+15%: Suggested fix included
+10%: First to report unique issue
+10%: Responsible disclosure timeline
```

---

## 5. Rules of Engagement

### Required ✅
```
1. Test on DevNet ONLY
   - Never test on mainnet
   - Use provided test accounts
   - Request funds if needed

2. Responsible Disclosure
   - Report privately first
   - Allow 90 days for fix
   - Coordinate public disclosure

3. Provide Details
   - Clear reproduction steps
   - Proof of concept code
   - Impact assessment
   - Suggested fix (optional)

4. Respect Scope
   - Only test in-scope components
   - Don't test out-of-scope items
   - Follow specified guidelines
```

### Prohibited ❌
```
1. NO Mainnet Testing
   - Any mainnet activity = disqualification
   - Immediate ban from program

2. NO Fund Theft
   - Even on DevNet, don't steal
   - This is for testing, not profit

3. NO DOS Attacks
   - Don't disrupt service
   - No spamming transactions
   - No network flooding

4. NO Social Engineering
   - No phishing team members
   - No credential harvesting
   - No physical intrusion

5. NO Public Disclosure
   - Don't tweet about bugs
   - No blog posts before fix
   - No GitHub issues publicly

6. NO Automated Scanning
   - No bots without permission
   - Manual testing preferred
   - Request approval for automation
```

### Safe Harbor
```
We pledge:
  - Not to pursue legal action for good-faith research
  - To work with you on fixing issues
  - To publicly acknowledge your contribution (with permission)
  - To pay bounties promptly upon verification
  - To provide clear communication throughout
```

---

## 6. Response Procedures

### Triage Timeline
```
Hour 0-4:   Acknowledgment of receipt
Hour 4-24:  Initial triage and severity assessment
Day 1-2:    Investigation and reproduction
Day 3-5:    Fix development
Day 6-7:    Fix deployment to DevNet
Day 8-14:   Verification and bounty payment
Day 15-90:  Public disclosure coordination (if applicable)
```

### Severity Assessment Criteria

#### Critical
- Direct fund theft possible
- System-wide compromise
- No user interaction required
- Exploitable remotely

#### High
- Significant functionality broken
- Limited fund impact
- Requires specific conditions
- Workaround difficult

#### Medium
- Limited functionality impact
- Workaround available
- Requires specific configuration
- Low immediate risk

#### Low
- Minor functionality issue
- Easy workaround
- Documentation only
- No immediate security risk

### Payment Process
```
1. Bug verified and severity assigned
2. Fix deployed and verified
3. Bounty amount confirmed
4. Payment initiated (USDC)
5. Transaction hash shared
6. Thank you note sent
7. Hall of Fame updated
```

---

## 7. Launch Checklist

### Pre-Launch (1 Week Before)
- [ ] Immunefi account created
- [ ] Project profile completed
- [ ] Scope clearly defined
- [ ] Rewards configured
- [ ] Escrow funded ($50,000)
- [ ] Team trained on triage
- [ ] Response procedures documented
- [ ] Legal review completed

### Launch Day
- [ ] Final review of program page
- [ ] Test submission process
- [ ] Announce on Twitter
- [ ] Post on Discord
- [ ] Email security researchers
- [ ] Monitor incoming reports

### Post-Launch (Ongoing)
- [ ] Weekly triage review
- [ ] Update leaderboard
- [ ] Pay bounties promptly
- [ ] Communicate with researchers
- [ ] Monthly program review

---

## 8. Marketing & Promotion

### Launch Announcement
```markdown
🛡️ PROXYHUBB BUG BOUNTY IS LIVE! 🛡️

We're excited to announce our bug bounty program on @immunefi!

🔍 Focus: Solana smart contract security
💰 Pool: $50,000 USDC
⏱️ Duration: 30 days
🎯 Scope: Multi-sig oracle, escrow, jury DAO

Critical findings up to $50,000!

Details: [Immunefi Link]

#Solana #BugBounty #Web3Security
```

### Target Audiences
1. Security Researchers
2. White Hat Hackers
3. Security Audit Firms
4. Solana Ecosystem Developers

---

**Ready to Launch! 🚀**

*Guide Version: 1.0*
