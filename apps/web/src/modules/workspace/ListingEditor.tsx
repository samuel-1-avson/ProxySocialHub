"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  createListing,
  getListingProofPolicy,
  getSuggestedListingPrice,
  marketplaceKeys,
  signListingOfferDev,
  type CreateListingRequest,
} from "@/lib/api/marketplace";
import { loadProviderSigningKey } from "@/lib/provider-config";
import {
  canonicalListingFields,
  publicKeyFromProviderSecret,
  raceTimeout,
  signListingOfferProof,
  signListingOfferWithSecret,
} from "@/lib/proofs/listing-offer";
import {
  defaultListingPricePerGB,
  evaluateListingPrice,
} from "@/lib/listing-price";
import {
  PageHeading,
  DataError,
  Loading,
  EmptyState,
  Status,
  amount,
  countryName,
} from "@/components/workspace/Patterns";
import { useSellerNodes } from "./SellerNodes";

export function ListingEditor() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const wallet = useWallet();
  const nodes = useSellerNodes();
  const policy = useQuery({
    queryKey: ["listing-proof-policy"],
    queryFn: getListingProofPolicy,
    staleTime: 60_000,
  });
  const [nodeId, setNodeId] = useState(params.get("node") ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("residential");
  const [protocol, setProtocol] = useState("http");
  const [rotation, setRotation] = useState("sticky");
  const [country, setCountry] = useState("");
  const [isp, setIsp] = useState("");
  const [price, setPrice] = useState(
    String(defaultListingPricePerGB("residential")),
  );
  const [capacity, setCapacity] = useState("");
  const [minimum, setMinimum] = useState("1");
  const [concurrency, setConcurrency] = useState("10");
  const [review, setReview] = useState<CreateListingRequest | null>(null);
  const [progress, setProgress] = useState("");
  const selectedId =
    nodeId || (nodes.data?.nodes.length === 1 ? nodes.data.nodes[0].id : "");
  const selectedNode = nodes.data?.nodes.find((node) => node.id === selectedId);
  const region = country || selectedNode?.country || "";
  const suggestion = useQuery({
    queryKey: ["listing-price-suggestion", region, type],
    queryFn: () => getSuggestedListingPrice(region, type),
    enabled: Boolean(region),
    staleTime: 60_000,
    retry: 1,
  });
  const guidance = evaluateListingPrice(
    Number(price),
    type,
    suggestion.data?.suggested_price,
  );
  const valid = Boolean(
    title.trim() &&
      selectedNode &&
      Number(price) > 0 &&
      !guidance.overHardCap &&
      Number(capacity) > 0 &&
      Number(minimum) > 0 &&
      Number(minimum) <= Number(capacity) &&
      Number.isInteger(Number(concurrency)) &&
      Number(concurrency) > 0 &&
      (!region || /^[A-Z]{2}$/.test(region)),
  );
  const publish = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!review || !policy.isSuccess || !selectedNode)
        throw new Error(
          "Load the publication requirements and review your node before publishing.",
        );
      const canon = canonicalListingFields(review);
      const payload: CreateListingRequest = {
        ...review,
        description: canon.description,
        protocol: canon.protocol,
        rotation_type: canon.rotationType,
        max_concurrency: canon.maxConcurrency,
        min_purchase_gb: canon.minPurchaseGb,
        country: canon.country,
        isp: canon.isp,
      };
      const required = policy.data.required;
      const nodeHotkey = selectedNode.hotkey?.trim() ?? "";
      const secret = loadProviderSigningKey(selectedNode.id);
      const deviceHotkey = secret
        ? await publicKeyFromProviderSecret(secret)
        : "";
      const walletHotkey =
        wallet.connected && wallet.publicKey ? wallet.publicKey.toBase58() : "";
      if (required || nodeHotkey) {
        if (secret && (!nodeHotkey || deviceHotkey === nodeHotkey)) {
          setProgress("Signing with this node’s local provider key…");
          payload.proof = await signListingOfferWithSecret(
            payload,
            selectedNode.id,
            selectedNode.gateway_node_id,
            secret,
          );
        } else if (
          wallet.connected &&
          wallet.signMessage &&
          walletHotkey &&
          (!nodeHotkey || walletHotkey === nodeHotkey)
        ) {
          setProgress("Approve the offer signature in your wallet…");
          payload.proof = await raceTimeout(
            signListingOfferProof(
              payload,
              selectedNode.id,
              selectedNode.gateway_node_id,
              walletHotkey,
              wallet.signMessage,
            ),
            60_000,
            "Wallet did not respond. Unlock it and review the offer again.",
          );
        } else if (policy.data.dev_server_signing) {
          setProgress("Requesting the configured development signature…");
          payload.proof = (await signListingOfferDev(payload)).proof;
        } else if (required)
          throw new Error(
            "This offer needs its node’s signing key. Use the browser that configured the node, or connect the wallet matching its provider hotkey.",
          );
      }
      setProgress("Submitting your offer…");
      return createListing(payload);
    },
    onSuccess: (listing) => {
      void client.invalidateQueries({ queryKey: marketplaceKeys.all });
      router.push(
        `/provider/listings${listing.status === "pending_review" ? "?submitted=pending_review" : ""}`,
      );
    },
    onSettled: () => setProgress(""),
  });
  function prepare() {
    if (!valid) return;
    publish.reset();
    setReview({
      title: title.trim(),
      description: description.trim(),
      provider_node_id: selectedId,
      proxy_type: type,
      protocol,
      rotation_type: rotation,
      country: region,
      isp: isp.trim(),
      price_per_gb: Number(price),
      available_bandwidth_gb: Number(capacity),
      min_purchase_gb: Number(minimum),
      max_concurrency: Number(concurrency),
    });
  }
  return (
    <div className="ui-page">
      <Link className="ui-link self-start" href="/provider/listings">
        ← Listings
      </Link>
      <PageHeading
        eyebrow="Seller workspace"
        title={review ? "Review your offer" : "Create a listing"}
        description="Describe the capacity you can supply, set its price, and review publication requirements."
      />
      {nodes.isLoading && <Loading label="Loading your nodes…" />}
      {nodes.isError && (
        <DataError error={nodes.error} retry={() => void nodes.refetch()} />
      )}
      {policy.isError && (
        <DataError error={policy.error} retry={() => void policy.refetch()} />
      )}
      {nodes.isSuccess && !nodes.data.nodes.length ? (
        <EmptyState
          title="Register a node first."
          description="An offer needs an owned node so purchased access can be linked to your supply."
          href="/provider/nodes/new"
          action="Set up a node"
        />
      ) : review ? (
        <section className="ui-surface ui-page">
          <div className="ui-section-heading">
            <h2>{review.title}</h2>
            <Status tone="neutral">Not published yet</Status>
          </div>
          <p className="ui-note">
            {review.description || "No additional description."}
          </p>
          <dl className="ui-detail-list">
            <div>
              <dt>Supply node</dt>
              <dd>{selectedNode?.name}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{countryName(review.country)}</dd>
            </div>
            <div>
              <dt>USD per GB</dt>
              <dd>${amount(review.price_per_gb, 4)}</dd>
            </div>
            <div>
              <dt>Available bandwidth</dt>
              <dd>{amount(review.available_bandwidth_gb)} GB</dd>
            </div>
            <div>
              <dt>Minimum purchase</dt>
              <dd>{amount(review.min_purchase_gb)} GB</dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>
                {review.proxy_type} · {review.protocol} · {review.rotation_type}
              </dd>
            </div>
            <div>
              <dt>Concurrent connections</dt>
              <dd>{review.max_concurrency}</dd>
            </div>
          </dl>
          <p className="ui-note">
            {policy.data?.required
              ? "A valid provider signature is required."
              : "This deployment permits offers without a provider signature."}{" "}
            The server decides whether this offer is active or needs review.
            Node health and offer publication remain separate.
          </p>
          {publish.isError && (
            <>
              <DataError error={publish.error} />
              <Link className="ui-link" href="/provider/listings">
                Check existing listings before submitting again →
              </Link>
            </>
          )}
          {progress && (
            <p className="ui-note" role="status">
              {progress}
            </p>
          )}
          <div className="ui-actions">
            <button
              className="ui-button secondary"
              disabled={publish.isPending}
              onClick={() => setReview(null)}
            >
              Back to editing
            </button>
            <button
              className="ui-button"
              disabled={publish.isPending || !policy.isSuccess}
              onClick={() => publish.mutate()}
            >
              {publish.isPending ? "Submitting…" : "Publish offer"}
            </button>
          </div>
        </section>
      ) : (
        <form
          className="ui-page"
          onSubmit={(e) => {
            e.preventDefault();
            prepare();
          }}
        >
          <section className="ui-surface ui-page">
            <h2>Offer & supply</h2>
            <div className="ui-form-grid">
              <label className="ui-field">
                Offer title
                <input
                  className="ui-input"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A clear name for your capacity"
                />
              </label>
              <label className="ui-field">
                Supply node
                <select
                  className="ui-select"
                  required
                  value={selectedId}
                  onChange={(e) => setNodeId(e.target.value)}
                >
                  <option value="">Choose your node</option>
                  {nodes.data?.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name} · {node.status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="ui-field">
              Description
              <textarea
                className="ui-input"
                rows={4}
                maxLength={5000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the service and any operating limits."
              />
            </label>
            {selectedNode && (
              <p className="ui-note">
                Reported node state: {selectedNode.status}. Heartbeat signature{" "}
                {selectedNode.latest_heartbeat_verified
                  ? "verified"
                  : "not verified"}
                .
              </p>
            )}
          </section>
          <section className="ui-surface ui-page">
            <h2>Connection & location</h2>
            <div className="ui-form-grid">
              <label className="ui-field">
                Proxy type
                <select
                  className="ui-select"
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setPrice(String(defaultListingPricePerGB(e.target.value)));
                  }}
                >
                  <option value="residential">Residential</option>
                  <option value="mobile">Mobile</option>
                  <option value="datacenter">Datacenter</option>
                </select>
              </label>
              <label className="ui-field">
                Protocol
                <select
                  className="ui-select"
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value)}
                >
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </label>
              <label className="ui-field">
                Session behavior
                <select
                  className="ui-select"
                  value={rotation}
                  onChange={(e) => setRotation(e.target.value)}
                >
                  <option value="sticky">Sticky</option>
                  <option value="rotating">Rotating</option>
                  <option value="static">Static</option>
                </select>
              </label>
              <label className="ui-field">
                Country code
                <input
                  className="ui-input"
                  maxLength={2}
                  pattern="[A-Za-z]{2}"
                  value={region}
                  onChange={(e) => setCountry(e.target.value.toUpperCase())}
                  placeholder="e.g. GH"
                />
              </label>
              <label className="ui-field">
                Internet provider
                <input
                  className="ui-input"
                  maxLength={120}
                  value={isp}
                  onChange={(e) => setIsp(e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="ui-field">
                Concurrent connections
                <input
                  className="ui-input"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={concurrency}
                  onChange={(e) => setConcurrency(e.target.value)}
                />
              </label>
            </div>
          </section>
          <section className="ui-surface ui-page">
            <h2>Price & capacity</h2>
            <div className="ui-form-grid">
              <label className="ui-field">
                USD per GB
                <input
                  className="ui-input"
                  type="number"
                  required
                  min="0.0001"
                  max="50"
                  step="0.0001"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
                <small>
                  Checkout converts the required escrow amount to SOL.
                </small>
              </label>
              <label className="ui-field">
                Available bandwidth (GB)
                <input
                  className="ui-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </label>
              <label className="ui-field">
                Minimum purchase (GB)
                <input
                  className="ui-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  max={Number(capacity) > 0 ? capacity : undefined}
                  value={minimum}
                  onChange={(e) => setMinimum(e.target.value)}
                />
              </label>
            </div>
            {suggestion.data && (
              <p className="ui-note">
                Suggested price from the pricing API: $
                {amount(suggestion.data.suggested_price, 4)} / GB.{" "}
                <button
                  type="button"
                  className="ui-link"
                  onClick={() =>
                    setPrice(String(suggestion.data!.suggested_price))
                  }
                >
                  Use suggested price
                </button>
              </p>
            )}
            {guidance.overSoftCap && !guidance.overHardCap && (
              <p className="ui-note">
                This price is above the default guidance and may require review.
              </p>
            )}
            {guidance.overHardCap && (
              <p className="ui-note" role="alert">
                The maximum allowed price is $50 / GB.
              </p>
            )}
          </section>
          <div className="ui-actions">
            <button
              className="ui-button"
              disabled={!valid || !policy.isSuccess}
            >
              Review listing
            </button>
            <Link className="ui-button secondary" href="/provider/listings">
              Cancel
            </Link>
          </div>
          {policy.isLoading && (
            <p className="ui-note" role="status">
              Loading publication requirements…
            </p>
          )}
        </form>
      )}
    </div>
  );
}
