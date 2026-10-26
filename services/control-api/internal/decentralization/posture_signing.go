package decentralization

import (
	"fmt"
	"os"
	"strings"
)

// W-28: signing trust. Production must never run with a single hot key
// and silent defaults. Fail closed at boot:
//   - multisig settlement asserted on
//   - a KMS/HSM signer fully configured (GCP, AWS, or GCP hot)
//   - no raw private key in the environment
//   - any keypair file still referenced must be encrypted at rest
//     (the loader additionally enforces 0600/owner at read time)

var kmsBoolFlags = []string{"USE_GCP_KMS", "USE_AWS_KMS", "USE_GCP_KMS_HOT"}

var keypairFileEnvVars = []string{
	"SOLANA_ORACLE_KEYPAIR",
	"SOLANA_TREASURY_HOT_KEYPAIR",
	"SOLANA_TREASURY_KEYPAIR",
	"PROXYHUB_MULTISIG_COSIGNER_KEYPAIR",
}

// KMSSignerConfigured reports whether at least one KMS/HSM signer is
// fully configured (flag on + key id/name + public key).
func KMSSignerConfigured() bool {
	gcp, _, gErr := StrictEnvBool("USE_GCP_KMS")
	aws, _, aErr := StrictEnvBool("USE_AWS_KMS")
	hot, _, hErr := StrictEnvBool("USE_GCP_KMS_HOT")
	if gErr != nil || aErr != nil || hErr != nil {
		return false
	}
	env := func(k string) string { return strings.TrimSpace(os.Getenv(k)) }
	switch {
	case gcp && env("GCP_KMS_KEY_NAME") != "" && env("GCP_KMS_PUBLIC_KEY") != "":
		return true
	case aws && env("AWS_KMS_KEY_ID") != "" && env("AWS_KMS_PUBLIC_KEY") != "":
		return true
	case hot && env("GCP_KMS_HOT_KEY_NAME") != "" && env("GCP_KMS_HOT_PUBLIC_KEY") != "":
		return true
	}
	return false
}

func validateSigningPosture() []string {
	var problems []string

	// KMS flags must parse in every environment (a typo silently
	// disabling KMS is exactly the failure this gate exists for).
	for _, key := range kmsBoolFlags {
		if _, _, err := StrictEnvBool(key); err != nil {
			problems = append(problems, err.Error())
		}
	}
	if !IsProduction() {
		return problems
	}

	if multi, set, err := StrictEnvBool("PROXYHUB_MULTISIG_SETTLE_ENABLED"); err != nil {
		problems = append(problems, err.Error())
	} else if !set || !multi {
		problems = append(problems, "PROXYHUB_MULTISIG_SETTLE_ENABLED must be true in production (W-28: no single-key settlement)")
	}

	if !KMSSignerConfigured() {
		problems = append(problems, "a KMS/HSM signer must be configured in production (set USE_GCP_KMS(+GCP_KMS_KEY_NAME,GCP_KMS_PUBLIC_KEY), USE_AWS_KMS(+AWS_KMS_KEY_ID,AWS_KMS_PUBLIC_KEY), or USE_GCP_KMS_HOT(+GCP_KMS_HOT_KEY_NAME,GCP_KMS_HOT_PUBLIC_KEY)) (W-28)")
	}

	if strings.TrimSpace(os.Getenv("ORACLE_PRIVATE_KEY")) != "" {
		problems = append(problems, "ORACLE_PRIVATE_KEY (raw private key in environment) is forbidden in production (W-28)")
	}

	// Any keypair file still referenced in production must be the
	// AES-256-GCM encrypted format; plaintext JSON keys are refused.
	for _, key := range keypairFileEnvVars {
		if strings.TrimSpace(os.Getenv(key)) != "" &&
			strings.TrimSpace(os.Getenv("ORACLE_KEYPAIR_ENCRYPTION_KEY")) == "" {
			problems = append(problems, fmt.Sprintf("%s references a keypair file in production but ORACLE_KEYPAIR_ENCRYPTION_KEY is unset: plaintext key files are refused in production (W-28)", key))
		}
	}
	return problems
}
