package indexer

import (
	"errors"
	"testing"
)

func TestIsIndexerRPCQuotaError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"helius max usage", errors.New("status code: 429 ... max usage reached"), true},
		{"jsonrpc 429", errors.New("(*jsonrpc.RPCError)({ Code: (int) 429, Message: Connection rate limits exceeded })"), true},
		{"onfinality throttle", errors.New("(*jsonrpc.RPCError)({ Code: (int) -32029, Message: Too Many Requests, Please apply an OnFinality API key })"), true},
		{"helius 32429", errors.New("code 32429: exceeded credit limit"), true},
		{"slot skipped", errors.New("failed to get block 1: block not available"), false},
		{"connection refused", errors.New("connection refused"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isIndexerRPCQuotaError(tc.err); got != tc.want {
				t.Fatalf("isIndexerRPCQuotaError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}
