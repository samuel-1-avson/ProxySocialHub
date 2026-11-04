package quality

import (
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
)

func TestQualityPricesUseMeasuredPerformanceAndProxyType(t *testing.T) {
	for _, tc := range []struct {
		kind                  string
		latency, speed, price float64
		tier                  string
	}{
		{"residential", 100, 30, 1.188, "Gold"}, {"mobile", 100, 30, 4.2, "Gold"}, {"datacenter", 100, 30, .18, "Gold"}, {"residential", 1000, 10, .99, "Silver"},
	} {
		a := models.ProxyAssessment{ProxyType: tc.kind}
		err := Evaluate(&a, Measurements{Samples: 3, SuccessfulSamples: 3, LatencyP50Ms: tc.latency, LatencyP95Ms: tc.latency, ThroughputMbps: tc.speed, BytesTransferred: 3 * 262144}, time.Now())
		if err != nil || a.Status != "passed" || a.Tier != tc.tier || math.Abs(a.PricePerGB-tc.price) > 1e-8 || !a.Provisional || a.Confidence > .5 {
			t.Fatalf("%+v: assessment=%+v error=%v", tc, a, err)
		}
	}
}

func TestQualityMissingAndInvalidEvidenceNeverIssuesPrice(t *testing.T) {
	for _, m := range []Measurements{
		{}, {Samples: 3, SuccessfulSamples: 4}, {Samples: 3, SuccessfulSamples: 3, LatencyP50Ms: 100, LatencyP95Ms: 99},
		{Samples: 3, SuccessfulSamples: 3, LatencyP50Ms: math.NaN()}, {Samples: 3, ThroughputMbps: math.Inf(1)},
		{Samples: 3, SuccessfulSamples: 3, LatencyP50Ms: 100, LatencyP95Ms: 100, ThroughputMbps: 1, BytesTransferred: 9999999},
	} {
		a := models.ProxyAssessment{ProxyType: "residential"}
		if err := Evaluate(&a, m, time.Now()); err == nil || a.PricePerGB != 0 || a.Status == "passed" {
			t.Fatalf("invalid measurements accepted: %+v %+v", m, a)
		}
	}
	for _, count := range []int{0, 1, 2} {
		a := models.ProxyAssessment{ProxyType: "residential"}
		m := Measurements{Samples: 3, SuccessfulSamples: count}
		if count > 0 {
			m.LatencyP50Ms, m.LatencyP95Ms, m.ThroughputMbps, m.BytesTransferred = 100, 100, 10, int64(count)*262144
		}
		if err := Evaluate(&a, m, time.Now()); err != nil || a.Status != "failed" || a.PricePerGB != 0 || a.ValidUntil != nil {
			t.Fatalf("partial success must fail: %+v %v", a, err)
		}
	}
}

func TestQualityOfferRejectsTamperingAndExpiredQuotes(t *testing.T) {
	now := time.Now()
	node := models.ProviderNode{ID: uuid.New(), UserID: uuid.New(), GatewayNodeID: "node-one", Hotkey: "key", IPAddress: "203.0.113.1"}
	cfg := Configuration{ProxyType: "residential", Protocol: "http", RotationType: "static", Country: "GH", MaxConcurrency: 5}
	a := models.ProxyAssessment{ID: uuid.New(), SellerID: node.UserID, ProviderNodeID: node.ID, ConfigurationHash: Fingerprint(node, cfg), ProxyType: cfg.ProxyType}
	if err := Evaluate(&a, Measurements{Samples: 3, SuccessfulSamples: 3, LatencyP50Ms: 100, LatencyP95Ms: 100, ThroughputMbps: 30, BytesTransferred: 3 * 262144}, now); err != nil {
		t.Fatal(err)
	}
	if err := ValidateOffer(a, node, cfg, a.PricePerGB, now); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*models.ProxyAssessment, *models.ProviderNode, *Configuration)
		price  float64
		at     time.Time
	}{
		{"price", func(*models.ProxyAssessment, *models.ProviderNode, *Configuration) {}, a.PricePerGB + .0001, now},
		{"NaN", func(*models.ProxyAssessment, *models.ProviderNode, *Configuration) {}, math.NaN(), now},
		{"expiry", func(*models.ProxyAssessment, *models.ProviderNode, *Configuration) {}, a.PricePerGB, now.Add(QuoteLifetime)},
		{"owner", func(a *models.ProxyAssessment, _ *models.ProviderNode, _ *Configuration) { a.SellerID = uuid.New() }, a.PricePerGB, now},
		{"node", func(_ *models.ProxyAssessment, n *models.ProviderNode, _ *Configuration) { n.ID = uuid.New() }, a.PricePerGB, now},
		{"key", func(_ *models.ProxyAssessment, n *models.ProviderNode, _ *Configuration) { n.Hotkey = "changed" }, a.PricePerGB, now},
		{"IP", func(_ *models.ProxyAssessment, n *models.ProviderNode, _ *Configuration) { n.IPAddress = "203.0.113.2" }, a.PricePerGB, now},
		{"capacity", func(_ *models.ProxyAssessment, _ *models.ProviderNode, c *Configuration) { c.MaxConcurrency++ }, a.PricePerGB, now},
		{"type", func(_ *models.ProxyAssessment, _ *models.ProviderNode, c *Configuration) { c.ProxyType = "mobile" }, a.PricePerGB, now},
		{"failed", func(a *models.ProxyAssessment, _ *models.ProviderNode, _ *Configuration) { a.Status = "failed" }, a.PricePerGB, now},
		{"policy", func(a *models.ProxyAssessment, _ *models.ProviderNode, _ *Configuration) {
			a.PolicyVersion = "obsolete"
		}, a.PricePerGB, now},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copyA, copyN, copyC := a, node, cfg
			tc.mutate(&copyA, &copyN, &copyC)
			if err := ValidateOffer(copyA, copyN, copyC, tc.price, tc.at); err == nil {
				t.Fatal("tampered offer accepted")
			}
		})
	}
}

func TestQualityEnforcementDefaultsOn(t *testing.T) {
	t.Setenv("LISTING_QUALITY_MODE", "")
	if !Enforced() {
		t.Fatal("must enforce by default")
	}
	t.Setenv("LISTING_QUALITY_MODE", "observe")
	if Enforced() {
		t.Fatal("observe rollout unavailable")
	}
	t.Setenv("LISTING_QUALITY_MODE", "typo")
	if !Enforced() {
		t.Fatal("invalid mode must fail closed")
	}
}
