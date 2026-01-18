# Security & Compliance

## Security Principles
- Zero Trust Architecture
- Least privilege access
- End-to-end encryption
- Provider isolation

## User & Provider Protection
- No raw traffic inspection
- Metadata-only monitoring
- Pseudonymous identities
- Encrypted credentials (HSM)

## Platform Security Controls
- TLS 1.3 everywhere
- mTLS for gateways
- Signed Edge Gateway binaries
- Anomaly & abuse detection

## Privacy-Aware Monitoring
What is monitored:
- Bandwidth usage
- Session duration
- Error rates

What is NOT monitored:
- Content
- Destination payloads
- User identity mapping

## Compliance (GDPR-style)
- Data minimization
- Right to erasure
- Encrypted at rest & transit
- Audit logs

## Threat Model
| Threat | Mitigation |
|------|------------|
| Rogue provider | Gateway attestation |
| Buyer abuse | Rate limiting |
| Traffic sniffing | E2EE tunnels |
| Billing fraud | Signed usage records |

