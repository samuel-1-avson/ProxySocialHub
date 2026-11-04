package api

import (
	"testing"

	"github.com/google/uuid"
)

func TestQualityHeartbeatGatewayBindingKeepsOwnerAndNodeScope(t *testing.T) {
	owner, other := uuid.New(), uuid.New()
	canonical := uuid.New().String()
	for _, declared := range []string{canonical, providerGatewayNodeID(owner)} {
		got, err := heartbeatGatewayBinding(owner, canonical, declared)
		if err != nil || got != declared {
			t.Fatalf("valid binding %q: %q %v", declared, got, err)
		}
	}
	for _, declared := range []string{"", providerGatewayNodeID(other), uuid.New().String(), "node_unrelated"} {
		if _, err := heartbeatGatewayBinding(owner, canonical, declared); err == nil {
			t.Fatalf("unrelated identity accepted: %q", declared)
		}
	}
}
