// Package quality owns the versioned, deterministic marketplace assessment policy.
package quality

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
)

const PolicyVersion = "proxy-quality-v1"
const QuoteLifetime = 30 * time.Minute
const BaseResidential = .99
const BaseMobile = 3.5
const BaseDatacenter = .15

// Enforced defaults on. Observe mode permits a measured rollout of the publication gate.
func Enforced() bool {
	return !strings.EqualFold(strings.TrimSpace(os.Getenv("LISTING_QUALITY_MODE")), "observe")
}

type Configuration struct {
	ProxyType      string `json:"proxy_type"`
	Protocol       string `json:"protocol"`
	RotationType   string `json:"rotation_type"`
	Country        string `json:"country"`
	MaxConcurrency int    `json:"max_concurrency"`
}

func Fingerprint(node models.ProviderNode, config Configuration) string {
	config.ProxyType = strings.ToLower(strings.TrimSpace(config.ProxyType))
	config.Country = strings.ToUpper(strings.TrimSpace(config.Country))
	if config.RotationType == "" {
		config.RotationType = "static"
	}
	chosen := map[string]bool{}
	for _, p := range strings.Split(strings.ToLower(config.Protocol), ",") {
		chosen[strings.TrimSpace(p)] = true
	}
	protocols := []string{}
	for _, p := range []string{"http", "https", "socks5"} {
		if chosen[p] {
			protocols = append(protocols, p)
		}
	}
	config.Protocol = strings.Join(protocols, ",")
	b, _ := json.Marshal(struct {
		Node         string
		Gateway      string
		Hotkey       string
		IP           string
		NodeType     string
		NodeProtocol string
		NodePort     int
		Config       Configuration
	}{
		node.ID.String(), node.GatewayNodeID, node.Hotkey, node.IPAddress, node.ConnectionType, node.Protocol, node.Port, config,
	})
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func BasePrice(proxyType string) float64 {
	switch proxyType {
	case "residential":
		return BaseResidential
	case "mobile":
		return BaseMobile
	case "datacenter":
		return BaseDatacenter
	}
	return 0
}

func PriceMultiplier(score float64) float64 {
	if score >= 90 {
		return 1.2
	}
	if score >= 70 {
		return 1
	}
	return .8
}

func PriceForScore(proxyType string, score float64) float64 {
	return math.Round(BasePrice(proxyType)*PriceMultiplier(score)*10000) / 10000
}

func Tier(score float64) string {
	if score >= 90 {
		return "Gold"
	}
	if score >= 70 {
		return "Silver"
	}
	return "Bronze"
}

type Measurements struct {
	Samples           int     `json:"samples"`
	SuccessfulSamples int     `json:"successful_samples"`
	LatencyP50Ms      float64 `json:"latency_p50_ms"`
	LatencyP95Ms      float64 `json:"latency_p95_ms"`
	ThroughputMbps    float64 `json:"throughput_mbps"`
	BytesTransferred  int64   `json:"bytes_transferred"`
}

// Evaluate never treats heartbeat defaults as measurements or claims historical uptime.
// All v1 assessments are provisional; the quote has no unverified geography premium.
func Evaluate(a *models.ProxyAssessment, m Measurements, now time.Time) error {
	for _, v := range []float64{m.LatencyP50Ms, m.LatencyP95Ms, m.ThroughputMbps} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return errors.New("invalid probe measurements")
		}
	}
	if m.Samples != 3 || m.SuccessfulSamples < 0 || m.SuccessfulSamples > m.Samples || m.BytesTransferred < 0 || m.BytesTransferred > 3*262144 {
		return errors.New("invalid probe sample or byte count")
	}
	if m.SuccessfulSamples > 0 && (m.LatencyP50Ms <= 0 || m.LatencyP95Ms < m.LatencyP50Ms || m.ThroughputMbps <= 0 || m.BytesTransferred != int64(m.SuccessfulSamples)*262144) {
		return errors.New("incomplete probe measurements")
	}
	a.Samples, a.SuccessfulSamples = m.Samples, m.SuccessfulSamples
	a.LatencyP50Ms, a.LatencyP95Ms, a.ThroughputMbps, a.BytesTransferred = m.LatencyP50Ms, m.LatencyP95Ms, m.ThroughputMbps, m.BytesTransferred
	a.CompletedAt, a.Provisional, a.PolicyVersion = &now, true, PolicyVersion
	a.Status, a.Tier, a.PricePerGB = "failed", "Unassessed", 0
	a.Confidence = .3 // Three samples establish connectivity, not long-term reliability.
	if m.SuccessfulSamples < 3 {
		a.Summary = "The proxy did not complete all three HTTPS transfers. Check connectivity and retry. No publication price was issued."
		return nil
	}
	latency := math.Max(0, math.Min(100, 100-(m.LatencyP95Ms-250)/25))
	throughput := math.Max(0, math.Min(100, m.ThroughputMbps/20*100))
	a.QualityScore = math.Round((45+.35*latency+.20*throughput)*100) / 100
	if a.QualityScore < 60 {
		a.Summary = "HTTPS works, but transfer performance is below the publication threshold. Improve latency or bandwidth and retry."
		return nil
	}
	multiplier := PriceMultiplier(a.QualityScore)
	base := BasePrice(a.ProxyType)
	if base == 0 {
		return errors.New("unsupported proxy type")
	}
	a.Status, a.Tier = "passed", Tier(a.QualityScore)
	a.PricePerGB = PriceForScore(a.ProxyType, a.QualityScore)
	expires := now.Add(QuoteLifetime)
	a.ValidUntil = &expires
	a.Summary = fmt.Sprintf("Provisional %s: 3/3 HTTPS transfers completed; p95 %.0f ms; %.2f Mbps. Price: $%.4f/GB × %.2f quality factor = $%.4f/GB. Uptime, IP reputation, location, connection type, rotation and maximum concurrency are not independently certified by this short test.", a.Tier, m.LatencyP95Ms, m.ThroughputMbps, base, multiplier, a.PricePerGB)
	return nil
}

func ValidateOffer(a models.ProxyAssessment, node models.ProviderNode, config Configuration, price float64, now time.Time) error {
	if a.SellerID != node.UserID || a.ProviderNodeID != node.ID || a.ConfigurationHash != Fingerprint(node, config) {
		return errors.New("assessment does not match this node and offer configuration")
	}
	if a.Status != "passed" || a.PolicyVersion != PolicyVersion || a.CompletedAt == nil || a.ValidUntil == nil || !a.ValidUntil.After(now) {
		return errors.New("run a fresh, successful quality assessment before publishing")
	}
	if math.IsNaN(price) || math.IsInf(price, 0) || math.Abs(price-a.PricePerGB) > .00000001 {
		return errors.New("accept the assessed price before publishing")
	}
	return nil
}
