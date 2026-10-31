package api

import "testing"

func TestNormalizeCLIPackageType(t *testing.T) {
	cases := map[string]string{
		"daemon":   "daemon",
		"wrapper":  "wrapper",
		"bundle":   "bundle",
		"desktop":  "desktop",
		" Desktop ": "desktop",
		"DESKTOP":  "desktop",
		"":         "daemon",
		"exe":      "daemon",
		"installer": "daemon",
	}
	for in, want := range cases {
		if got := normalizeCLIPackageType(in); got != want {
			t.Errorf("normalizeCLIPackageType(%q) = %q, want %q", in, got, want)
		}
	}
}
