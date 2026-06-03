package discovery

import "testing"

func TestOffset_FirstPageAliases(t *testing.T) {
	if got := Offset(0, 20); got != 0 {
		t.Fatalf("page 0: got %d", got)
	}
	if got := Offset(1, 20); got != 0 {
		t.Fatalf("page 1: got %d", got)
	}
	if got := Offset(2, 20); got != 20 {
		t.Fatalf("page 2: got %d", got)
	}
}
