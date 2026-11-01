"use client";
import { useHydrated } from "@/hooks/useHydrated";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { RecordHeading } from "@/components/explorer/RecordPatterns";
export default function WalletsEntryPage() {
  const ready = useHydrated();
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="ui-page">
      <RecordHeading
        title="Wallet lookup"
        description="Look up public Solana wallet records, balances, and indexed transactions. Wallet ownership is not inferred from an address."
      />
      <section className="ui-surface wallet-lookup">
        <span className="ui-empty-icon">
          <Wallet size={28} />
        </span>
        <h2>Find a wallet</h2>
        <p>
          Enter the full Solana public address. You do not need to connect a
          wallet.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = address.trim();
            if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
              setError(
                "Enter a valid Solana address using 32–44 base58 characters.",
              );
              return;
            }
            router.push("/explorer/wallets/" + encodeURIComponent(value));
          }}
        >
          <label className="ui-field" htmlFor="wallet-address">
            Solana wallet address
            <input
              className="ui-input"
              id="wallet-address"
              disabled={!ready}
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setError("");
              }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              aria-invalid={!!error}
              aria-describedby={error ? "wallet-address-error" : undefined}
              placeholder="Enter the complete public address"
            />
          </label>
          {error && (
            <p
              id="wallet-address-error"
              className="ui-field-error"
              role="alert"
            >
              {error}
            </p>
          )}
          <button className="ui-button">Look up wallet</button>
        </form>
      </section>
    </div>
  );
}
