package worker

import (
	"log"
	"runtime/debug"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var workerPanicsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "proxyhubb_worker_panics_total",
		Help: "Number of recovered panics in background workers.",
	},
	[]string{"worker"},
)

// Go starts a one-shot background task with panic recovery.
func Go(name string, fn func()) {
	go func() {
		run(name, fn)
	}()
}

// GoSupervised starts a background task that is restarted after a panic.
func GoSupervised(name string, restartDelay time.Duration, fn func()) {
	go func() {
		for {
			if !run(name, fn) {
				return
			}

			log.Printf("[Worker] Restarting %s after panic in %v", name, restartDelay)
			timer := time.NewTimer(restartDelay)
			<-timer.C
		}
	}()
}

// RunSafely executes an inline task with panic recovery.
func RunSafely(name string, fn func()) {
	_ = run(name, fn)
}

func run(name string, fn func()) (panicked bool) {
	defer func() {
		if recovered := recover(); recovered != nil {
			panicked = true
			workerPanicsTotal.WithLabelValues(name).Inc()
			log.Printf("[Worker] %s panicked: %v\n%s", name, recovered, debug.Stack())
		}
	}()

	fn()
	return false
}
