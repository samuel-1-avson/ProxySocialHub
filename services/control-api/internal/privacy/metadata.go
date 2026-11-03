package privacy

import (
	"github.com/proxyhubb/control-api/internal/models"
)

// ZKMetadataSentry manages the confidentiality of node identifiers
type ZKMetadataSentry struct{}

func NewZKMetadataSentry() *ZKMetadataSentry {
	return &ZKMetadataSentry{}
}

// SanitizeListing protects sensitive node physical identifiers
func (s *ZKMetadataSentry) SanitizeListing(l *models.ProxyListing) {
	// Application redaction only; no zero-knowledge proof is generated.

	// Obfuscate physical footprint for discovery. Labels must read as
	// intentional privacy, not as quality claims (audit E.2): the real
	// country/ISP are part of the signed listing offer and are only
	// revealed via the session handshake after escrow.
	l.Country = "Hidden until session"
	l.ISP = "Hidden until session"

	// Ensure IP is NEVER included in public discovery JSON
	// The IP is only revealed to the Consumer via a signed session
	// handshake after Escrow is initialized.
}

// GenerateCapabilityProof has no implementation. An empty value must never be
// presented as a cryptographic proof.
func (s *ZKMetadataSentry) GenerateCapabilityProof(node models.Node) string { return "" }
