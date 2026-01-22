package circuitbreaker

import (
	"errors"
	"testing"
	"time"
)

func TestCircuitBreakerClosed(t *testing.T) {
	config := Config{
		MaxFailures:      3,
		ResetTimeout:     100 * time.Millisecond,
		SuccessThreshold: 2,
		RequestTimeout:   50 * time.Millisecond,
	}
	
	cb := New(config)
	
	// Should start in closed state
	if cb.State() != Closed {
		t.Errorf("Expected initial state to be Closed, got %v", cb.State())
	}
	
	// Successful calls should keep it closed
	for i := 0; i < 5; i++ {
		err := cb.Call(func() error {
			return nil
		})
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}
		if cb.State() != Closed {
			t.Errorf("Expected state to remain Closed, got %v", cb.State())
		}
	}
}

func TestCircuitBreakerOpens(t *testing.T) {
	config := Config{
		MaxFailures:      3,
		ResetTimeout:     100 * time.Millisecond,
		SuccessThreshold: 2,
		RequestTimeout:   50 * time.Millisecond,
	}
	
	cb := New(config)
	testError := errors.New("test error")
	
	// Make failures to open the circuit
	for i := 0; i < 3; i++ {
		err := cb.Call(func() error {
			return testError
		})
		if err != testError {
			t.Errorf("Expected test error, got %v", err)
		}
	}
	
	// Circuit should now be open
	if cb.State() != Open {
		t.Errorf("Expected state to be Open, got %v", cb.State())
	}
	
	// Next call should fail immediately
	err := cb.Call(func() error {
		t.Error("Function should not be called when circuit is open")
		return nil
	})
	
	if err != ErrCircuitOpen {
		t.Errorf("Expected ErrCircuitOpen, got %v", err)
	}
}

func TestCircuitBreakerHalfOpen(t *testing.T) {
	config := Config{
		MaxFailures:      2,
		ResetTimeout:     50 * time.Millisecond,
		SuccessThreshold: 2,
		RequestTimeout:   100 * time.Millisecond,
	}
	
	cb := New(config)
	testError := errors.New("test error")
	
	// Open the circuit
	for i := 0; i < 2; i++ {
		cb.Call(func() error {
			return testError
		})
	}
	
	if cb.State() != Open {
		t.Errorf("Expected state to be Open, got %v", cb.State())
	}
	
	// Wait for reset timeout
	time.Sleep(60 * time.Millisecond)
	
	// Next call should transition to half-open
	err := cb.Call(func() error {
		return nil
	})
	
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	
	if cb.State() != HalfOpen {
		t.Errorf("Expected state to be HalfOpen, got %v", cb.State())
	}
}

func TestCircuitBreakerHalfOpenToClosed(t *testing.T) {
	config := Config{
		MaxFailures:      2,
		ResetTimeout:     50 * time.Millisecond,
		SuccessThreshold: 2,
		RequestTimeout:   100 * time.Millisecond,
	}
	
	cb := New(config)
	testError := errors.New("test error")
	
	// Open the circuit
	for i := 0; i < 2; i++ {
		cb.Call(func() error {
			return testError
		})
	}
	
	// Wait for reset timeout
	time.Sleep(60 * time.Millisecond)
	
	// Make successful calls to close the circuit
	for i := 0; i < 2; i++ {
		err := cb.Call(func() error {
			return nil
		})
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}
	}
	
	// Circuit should now be closed
	if cb.State() != Closed {
		t.Errorf("Expected state to be Closed, got %v", cb.State())
	}
}

func TestCircuitBreakerHalfOpenToOpen(t *testing.T) {
	config := Config{
		MaxFailures:      2,
		ResetTimeout:     50 * time.Millisecond,
		SuccessThreshold: 2,
		RequestTimeout:   100 * time.Millisecond,
	}
	
	cb := New(config)
	testError := errors.New("test error")
	
	// Open the circuit
	for i := 0; i < 2; i++ {
		cb.Call(func() error {
			return testError
		})
	}
	
	// Wait for reset timeout
	time.Sleep(60 * time.Millisecond)
	
	// First call transitions to half-open
	cb.Call(func() error {
		return nil
	})
	
	if cb.State() != HalfOpen {
		t.Errorf("Expected state to be HalfOpen, got %v", cb.State())
	}
	
	// Failure in half-open should go back to open
	err := cb.Call(func() error {
		return testError
	})
	
	if err != testError {
		t.Errorf("Expected test error, got %v", err)
	}
	
	if cb.State() != Open {
		t.Errorf("Expected state to be Open, got %v", cb.State())
	}
}

func TestCircuitBreakerTimeout(t *testing.T) {
	config := Config{
		MaxFailures:      3,
		ResetTimeout:     100 * time.Millisecond,
		SuccessThreshold: 2,
		RequestTimeout:   50 * time.Millisecond,
	}
	
	cb := New(config)
	
	// Call that takes longer than timeout
	err := cb.CallWithTimeout(func() error {
		time.Sleep(100 * time.Millisecond)
		return nil
	})
	
	if err != ErrRequestTimeout {
		t.Errorf("Expected ErrRequestTimeout, got %v", err)
	}
}

func TestCircuitBreakerStats(t *testing.T) {
	config := Config{
		MaxFailures:      3,
		ResetTimeout:     100 * time.Millisecond,
		SuccessThreshold: 2,
		RequestTimeout:   50 * time.Millisecond,
	}
	
	cb := New(config)
	testError := errors.New("test error")
	
	// Make some failures
	for i := 0; i < 2; i++ {
		cb.Call(func() error {
			return testError
		})
	}
	
	stats := cb.Stats()
	
	if stats.State != "closed" {
		t.Errorf("Expected state 'closed', got %s", stats.State)
	}
	
	if stats.Failures != 2 {
		t.Errorf("Expected 2 failures, got %d", stats.Failures)
	}
	
	if stats.LastFailure == nil {
		t.Error("Expected LastFailure to be set")
	}
}

func TestCircuitBreakerStateCallback(t *testing.T) {
	config := Config{
		MaxFailures:      2,
		ResetTimeout:     50 * time.Millisecond,
		SuccessThreshold: 1,
		RequestTimeout:   100 * time.Millisecond,
	}
	
	cb := New(config)
	testError := errors.New("test error")
	
	var stateChanges []string
	cb.OnStateChange(func(from, to State) {
		stateChanges = append(stateChanges, from.String()+"->"+to.String())
	})
	
	// Open the circuit
	for i := 0; i < 2; i++ {
		cb.Call(func() error {
			return testError
		})
	}
	
	// Wait and make successful call to transition to half-open then closed
	time.Sleep(60 * time.Millisecond)
	cb.Call(func() error {
		return nil
	})
	cb.Call(func() error {
		return nil
	})
	
	expectedChanges := []string{"closed->open", "open->half-open", "half-open->closed"}
	if len(stateChanges) != len(expectedChanges) {
		t.Errorf("Expected %d state changes, got %d: %v", len(expectedChanges), len(stateChanges), stateChanges)
	}
	
	for i, expected := range expectedChanges {
		if i < len(stateChanges) && stateChanges[i] != expected {
			t.Errorf("Expected state change %s, got %s", expected, stateChanges[i])
		}
	}
}