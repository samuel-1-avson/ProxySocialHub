package api

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// heartbeatGatewayBinding supports daemons that still sign the authenticated
// provider's legacy runtime identity after the gateway adopts a node UUID.
// The provider-node UUID remains in the signed payload, ownership is checked by
// the heartbeat handler, and the registered hotkey/signature checks still apply.
func heartbeatGatewayBinding(owner uuid.UUID, canonical, declared string) (string, error) {
	canonical, declared = strings.TrimSpace(canonical), strings.TrimSpace(declared)
	if declared != "" && (declared == canonical || declared == providerGatewayNodeID(owner)) {
		return declared, nil
	}
	return "", fmt.Errorf("heartbeat gateway identity does not match this provider")
}
