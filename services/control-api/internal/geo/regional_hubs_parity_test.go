package geo

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// TestRegionalHubsTypeScriptParity ensures Go hub anchors match apps/web regional-hubs-data.ts.
func TestRegionalHubsTypeScriptParity(t *testing.T) {
	goHubs := RegionalHubsSnapshot()
	tsHubs, err := loadTypeScriptRegionalHubs()
	if err != nil {
		t.Fatalf("load TS hubs: %v", err)
	}

	for cc, goList := range goHubs {
		tsList, ok := tsHubs[cc]
		if !ok {
			t.Fatalf("country %s present in Go but missing in TypeScript", cc)
		}
		if len(goList) != len(tsList) {
			t.Fatalf("country %s hub count: go=%d ts=%d", cc, len(goList), len(tsList))
		}
		for i := range goList {
			if !hubCoordsClose(goList[i], tsList[i]) {
				t.Fatalf("country %s hub[%d]: go=%+v ts=%+v", cc, i, goList[i], tsList[i])
			}
		}
	}

	for cc := range tsHubs {
		if _, ok := goHubs[cc]; !ok {
			t.Fatalf("country %s present in TypeScript but missing in Go", cc)
		}
	}
}

func hubCoordsClose(a, b HubSnapshot) bool {
	if a.Name != b.Name {
		return false
	}
	const eps = 0.0005
	return nearlyEqual(a.Lat, b.Lat, eps) && nearlyEqual(a.Lon, b.Lon, eps)
}

func nearlyEqual(a, b, eps float64) bool {
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	return diff <= eps
}

var (
	tsCountryRe      = regexp.MustCompile(`(?m)^\s+([A-Z]{2}):\s*\[`)
	tsHubReSingle    = regexp.MustCompile(`h\('([^']+)',\s*([-\d.]+),\s*([-\d.]+)`)
	tsHubReDouble    = regexp.MustCompile(`h\("([^"]+)",\s*([-\d.]+),\s*([-\d.]+)`)
)

func loadTypeScriptRegionalHubs() (map[string][]HubSnapshot, error) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		return nil, os.ErrInvalid
	}
	// services/control-api/internal/geo → repo root
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", ".."))
	tsPath := filepath.Join(repoRoot, "apps", "web", "src", "lib", "geo", "regional-hubs-data.ts")
	raw, err := os.ReadFile(tsPath)
	if err != nil {
		return nil, err
	}

	content := string(raw)
	out := make(map[string][]HubSnapshot)
	current := ""
	for _, line := range strings.Split(content, "\n") {
		if m := tsCountryRe.FindStringSubmatch(line); len(m) == 2 {
			current = m[1]
		}
		if current == "" {
			continue
		}
		m := tsHubReSingle.FindStringSubmatch(line)
		if m == nil {
			m = tsHubReDouble.FindStringSubmatch(line)
		}
		if len(m) != 4 {
			continue
		}
		lat, err1 := strconv.ParseFloat(m[2], 64)
		lon, err2 := strconv.ParseFloat(m[3], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		out[current] = append(out[current], HubSnapshot{Name: m[1], Lat: lat, Lon: lon})
	}
	return out, nil
}
