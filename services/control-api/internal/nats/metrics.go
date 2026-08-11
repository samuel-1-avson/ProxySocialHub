package nats

import (
	"context"
	"log"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	natsConsumerNumPending = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "nats_consumer_num_pending",
			Help: "JetStream consumer messages pending (lag)",
		},
		[]string{"stream", "consumer"},
	)
	natsConsumerNumAckPending = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "nats_consumer_num_ack_pending",
			Help: "JetStream consumer ack-pending messages",
		},
		[]string{"stream", "consumer"},
	)
	natsStreamMessages = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "nats_stream_messages",
			Help: "JetStream stream total messages",
		},
		[]string{"stream"},
	)
	natsStreamBytes = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "nats_stream_bytes",
			Help: "JetStream stream total bytes",
		},
		[]string{"stream"},
	)
	natsLagScrapeErrors = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "nats_lag_scrape_errors_total",
			Help: "Failures scraping JetStream consumer lag",
		},
	)
)

var knownStreams = []string{"SESSIONS", "SETTLEMENT", "TELEMETRY", "MESSAGING", "TREASURY"}

// StartConsumerLagScraper publishes JetStream lag gauges every interval.
// Safe no-op when JetStream is not initialized.
func StartConsumerLagScraper(interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		scrapeConsumerLag()
		for range ticker.C {
			scrapeConsumerLag()
		}
	}()
	log.Printf("NATS consumer lag scraper started (interval=%s)", interval)
}

func scrapeConsumerLag() {
	if JS == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for _, streamName := range knownStreams {
		stream, err := JS.Stream(ctx, streamName)
		if err != nil {
			natsLagScrapeErrors.Inc()
			continue
		}
		sinfo, err := stream.Info(ctx)
		if err != nil {
			natsLagScrapeErrors.Inc()
			continue
		}
		natsStreamMessages.WithLabelValues(streamName).Set(float64(sinfo.State.Msgs))
		natsStreamBytes.WithLabelValues(streamName).Set(float64(sinfo.State.Bytes))

		lister := stream.ListConsumers(ctx)
		for info := range lister.Info() {
			if info == nil {
				continue
			}
			labels := []string{streamName, info.Name}
			natsConsumerNumPending.WithLabelValues(labels...).Set(float64(info.NumPending))
			natsConsumerNumAckPending.WithLabelValues(labels...).Set(float64(info.NumAckPending))
		}
		if err := lister.Err(); err != nil {
			natsLagScrapeErrors.Inc()
		}
	}
}
