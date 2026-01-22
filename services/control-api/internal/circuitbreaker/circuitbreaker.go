package circuitbreaker

import (
	"errors"
	"sync"
	"time"
)

// State represents the circuit breaker state
type State int

const (
	// Closed state allows requests to pass through
	Closed State = iota
	// Open state blocks requests and returns errors immediately
	Open
	// HalfOpen state allows limited requests to test if service recovered
	HalfOpen
)

func (s State) String() string {
	switch s {
	case Closed:
		return "closed"
	case Open:
		return "open"
	case HalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// Config holds circuit breaker configuration
type Config struct {
	// MaxFailures is the number of failures before opening the circuit
	MaxFailures int
	// ResetTimeout is the time to wait before transitioning from Open to HalfOpen
	ResetTimeout time.Duration
	// SuccessThreshold is the number of consecutive successes needed to close from HalfOpen
	SuccessThreshold int
	// Timeout for individual requests
	RequestTimeout time.Duration
}

// DefaultConfig returns sensible defaults for circuit breaker
func DefaultConfig() Config {
	return Config{
		MaxFailures:      5,
		ResetTimeout:     30 * time.Second,
		SuccessThreshold: 3,
		RequestTimeout:   10 * time.Second,
	}
}

// CircuitBreaker implements the circuit breaker pattern
type CircuitBreaker struct {
	config           Config
	state            State
	failures         int
	successes        int
	lastFailureTime  time.Time
	mutex            sync.RWMutex
	onStateChange    func(from, to State)
}

// Errors
var (
	ErrCircuitOpen     = errors.New("circuit breaker is open")
	ErrRequestTimeout  = errors.New("request timeout")
	ErrTooManyRequests = errors.New("too many requests in half-open state")
)

// New creates a new circuit breaker with the given configuration
func New(config Config) *CircuitBreaker {
	return &CircuitBreaker{
		config: config,
		state:  Closed,
	}
}

// OnStateChange sets a callback for state changes
func (cb *CircuitBreaker) OnStateChange(fn func(from, to State)) {
	cb.onStateChange = fn
}

// Call executes the given function with circuit breaker protection
func (cb *CircuitBreaker) Call(fn func() error) error {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()

	// Check if we can make the request
	if !cb.canRequest() {
		return ErrCircuitOpen
	}

	// Execute the function
	err := fn()
	
	// Update state based on result
	cb.updateState(err)
	
	return err
}

// CallWithTimeout executes the function with timeout protection
func (cb *CircuitBreaker) CallWithTimeout(fn func() error) error {
	done := make(chan error, 1)
	
	go func() {
		done <- cb.Call(fn)
	}()
	
	select {
	case err := <-done:
		return err
	case <-time.After(cb.config.RequestTimeout):
		// Treat timeout as failure
		cb.mutex.Lock()
		cb.updateState(ErrRequestTimeout)
		cb.mutex.Unlock()
		return ErrRequestTimeout
	}
}

// canRequest determines if a request can be made based on current state
func (cb *CircuitBreaker) canRequest() bool {
	switch cb.state {
	case Closed:
		return true
	case Open:
		// Check if we should transition to half-open
		if time.Since(cb.lastFailureTime) > cb.config.ResetTimeout {
			cb.setState(HalfOpen)
			cb.successes = 0
			return true
		}
		return false
	case HalfOpen:
		// Allow limited requests in half-open state
		return cb.successes < cb.config.SuccessThreshold
	default:
		return false
	}
}

// updateState updates the circuit breaker state based on the result
func (cb *CircuitBreaker) updateState(err error) {
	if err != nil {
		cb.failures++
		cb.lastFailureTime = time.Now()
		cb.successes = 0
		
		switch cb.state {
		case Closed:
			if cb.failures >= cb.config.MaxFailures {
				cb.setState(Open)
			}
		case HalfOpen:
			cb.setState(Open)
		}
	} else {
		cb.failures = 0
		cb.successes++
		
		switch cb.state {
		case HalfOpen:
			if cb.successes >= cb.config.SuccessThreshold {
				cb.setState(Closed)
			}
		}
	}
}

// setState changes the circuit breaker state and calls the callback
func (cb *CircuitBreaker) setState(newState State) {
	if cb.state != newState {
		oldState := cb.state
		cb.state = newState
		
		if cb.onStateChange != nil {
			cb.onStateChange(oldState, newState)
		}
	}
}

// State returns the current circuit breaker state
func (cb *CircuitBreaker) State() State {
	cb.mutex.RLock()
	defer cb.mutex.RUnlock()
	return cb.state
}

// Failures returns the current failure count
func (cb *CircuitBreaker) Failures() int {
	cb.mutex.RLock()
	defer cb.mutex.RUnlock()
	return cb.failures
}

// Successes returns the current success count (relevant in HalfOpen state)
func (cb *CircuitBreaker) Successes() int {
	cb.mutex.RLock()
	defer cb.mutex.RUnlock()
	return cb.successes
}

// Stats returns current circuit breaker statistics
type Stats struct {
	State     string    `json:"state"`
	Failures  int       `json:"failures"`
	Successes int       `json:"successes"`
	LastFailure *time.Time `json:"last_failure,omitempty"`
}

// Stats returns the current circuit breaker statistics
func (cb *CircuitBreaker) Stats() Stats {
	cb.mutex.RLock()
	defer cb.mutex.RUnlock()
	
	stats := Stats{
		State:     cb.state.String(),
		Failures:  cb.failures,
		Successes: cb.successes,
	}
	
	if !cb.lastFailureTime.IsZero() {
		stats.LastFailure = &cb.lastFailureTime
	}
	
	return stats
}