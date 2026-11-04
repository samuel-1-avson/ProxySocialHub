// Hubbie actions: prepare -> user confirms -> execute exactly once.
//
// The model can only PREPARE drafts (`prepare_buy`, `prepare_listing`). A
// draft changes nothing. Execution happens only when the signed-in user
// presses Approve, which calls POST /api/assistant/actions with the draft id:
// a browser action the model cannot perform, trigger, or forge. Every draft
// is owner-bound, expires after ten minutes, is consumed by any execution
// attempt, and is re-validated against live platform data before the
// mutation runs (price or status changes abort with an honest message).
//
// Buy execution creates the order through the existing API. With
// payment=platform_balance (managed wallets) it also opens escrow from the
// managed balance server-side; otherwise funding/signing continues in the
// order page — Hubbie still never signs or touches credentials.
// Listing execution asks the offer's own node to sign (the same
// offer-signatures flow the editor uses) when the deployment requires
// proofs, then creates the listing.

import { ASSISTANT_DESTINATIONS, type AssistantAction, type AssistantActionResult } from "../assistant";
import { errorCode, id, num, obj, platformGet, platformPost, str, type PlatformContext } from "./assistant-platform";

export function assistantActionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASSISTANT_ACTIONS_ENABLED !== "0";
}

/** Stable non-identifying correlation id for usage logs (not a security hash). */
export function accountTag(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface BuyDraft {
  listingId: string;
  listingTitle: string | null;
  bandwidthGb: number;
  sessionType: "rotating" | "sticky";
  payment: "wallet_signing" | "platform_balance";
  priceUsdPerGb: number;
  estimatedTotalUsd: number;
}
export interface ListingDraft {
  nodeId: string;
  nodeName: string | null;
  title: string;
  description: string;
  proxyType: string;
  protocol: string;
  country: string;
  pricePerGb: number;
  availableBandwidthGb: number;
  minPurchaseGb: number;
  maxConcurrency: number;
}
interface StoredDraft {
  id: string;
  userId: string;
  kind: AssistantAction["kind"];
  buy?: BuyDraft;
  listing?: ListingDraft;
  card: AssistantAction;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

const DRAFT_TTL_MS = 10 * 60_000;
const MAX_DRAFTS = 500;

export class AssistantDraftStore {
  private drafts = new Map<string, StoredDraft>();
  constructor(private deps: { now?: () => number; newId?: () => string } = {}) {}

  private now() { return this.deps.now?.() ?? Date.now(); }
  private newId() {
    return this.deps.newId?.() ?? globalThis.crypto?.randomUUID?.()
      ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  create(userId: string, kind: AssistantAction["kind"], payload: { buy?: BuyDraft; listing?: ListingDraft }, card: Omit<AssistantAction, "draftId" | "kind" | "expiresAt">): AssistantAction {
    const now = this.now();
    for (const [key, draft] of this.drafts) if (draft.expiresAt <= now) this.drafts.delete(key);
    if (this.drafts.size >= MAX_DRAFTS) {
      const oldest = [...this.drafts.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.drafts.delete(oldest.id);
    }
    const expiresAt = now + DRAFT_TTL_MS;
    const full: AssistantAction = { draftId: this.newId(), kind, expiresAt: new Date(expiresAt).toISOString(), ...card };
    this.drafts.set(full.draftId, { id: full.draftId, userId, kind, ...payload, card: full, createdAt: now, expiresAt, consumedAt: null });
    return full;
  }

  /** Consume-on-attempt: a draft can be executed at most once, by its owner. */
  take(userId: string, draftId: string): StoredDraft | null {
    const draft = this.drafts.get(draftId);
    if (!draft || draft.userId !== userId || draft.consumedAt !== null || draft.expiresAt <= this.now()) return null;
    draft.consumedAt = this.now();
    return draft;
  }
}

let storeSingleton: AssistantDraftStore | null = null;
export function getAssistantDraftStore(): AssistantDraftStore {
  storeSingleton ??= new AssistantDraftStore();
  return storeSingleton;
}

export interface PrepareOutcome { ok: boolean; label: string; data: unknown; action?: AssistantAction }
const failed = (label: string, error: string): PrepareOutcome => ({ ok: false, label, data: { error } });
const money = (v: number) => Math.round(v * 100) / 100;

export async function prepareBuy(ctx: PlatformContext & { userId: string; drafts: AssistantDraftStore }, args: Record<string, unknown>): Promise<PrepareOutcome> {
  const listingId = id(args.listing_id);
  const bandwidthGb = num(args.bandwidth_gb);
  const sessionType = args.session_type === "sticky" ? "sticky" : "rotating";
  const payment = args.payment === "platform_balance" ? "platform_balance" : "wallet_signing";
  if (!listingId) return failed("Prepare purchase", "Use a listing id returned by find_listings.");
  if (bandwidthGb === null || bandwidthGb <= 0 || bandwidthGb > 1000) return failed("Prepare purchase", "bandwidth_gb must be greater than 0 and at most 1000 for a chat purchase.");
  const res = await platformGet(ctx, `/v1/listings/${listingId}`, false);
  const listing = Object.keys(obj(res.body.listing)).length ? obj(res.body.listing) : res.body;
  if (!res.ok || !id(listing.id)) return failed("Prepare purchase", "That listing could not be read. Search the marketplace again.");
  const price = num(listing.price_per_gb);
  const available = num(listing.available_bandwidth_gb);
  const minPurchase = num(listing.min_purchase_gb);
  if (price === null || price <= 0) return failed("Prepare purchase", "That listing has no usable price right now.");
  if (available !== null && available > 0 && bandwidthGb > available) return failed("Prepare purchase", `Only ${available} GB are available on that listing.`);
  if (minPurchase !== null && minPurchase > 0 && bandwidthGb < minPurchase) return failed("Prepare purchase", `The minimum purchase for that listing is ${minPurchase} GB.`);
  const title = str(listing.title) || "Proxy listing";
  const total = money(price * bandwidthGb);
  const draft: BuyDraft = { listingId, listingTitle: title, bandwidthGb, sessionType: sessionType as BuyDraft["sessionType"], payment: payment as BuyDraft["payment"], priceUsdPerGb: price, estimatedTotalUsd: total };
  const action = ctx.drafts.create(ctx.userId, "buy_order", { buy: draft }, {
    title: `Buy ${bandwidthGb} GB — ${title}`,
    summary: [
      `${bandwidthGb} GB at $${price} / GB · about $${total} total (server confirms the final total at order creation; bulk discounts may lower it)`,
      `Session: ${sessionType} · Seller-declared country ${str(listing.country, 2) || "—"} (not verified exit evidence)`,
      payment === "platform_balance"
        ? "Approving creates the order AND locks payment in escrow from your ProxyHubb managed balance."
        : "Approving creates the order only. No money moves until you fund escrow and sign in your wallet on the order page.",
    ],
    confirmLabel: payment === "platform_balance" ? "Approve & pay from balance" : "Create order",
  });
  return {
    ok: true, label: "Prepared a purchase for your approval", action,
    data: { draft_id: action.draftId, prepared: true, executed: false, listing: title, bandwidth_gb: bandwidthGb, estimated_total_usd: total, payment, expires_at: action.expiresAt, note: "Nothing has been bought. The user must press the approval button on the card; only then is the order created." },
  };
}

const PROXY_TYPES = ["residential", "mobile", "datacenter"];
const PROTOCOLS = ["http", "https", "socks5", "http,socks5"];

export async function prepareListing(ctx: PlatformContext & { userId: string; role?: string; drafts: AssistantDraftStore }, args: Record<string, unknown>): Promise<PrepareOutcome> {
  if (!["provider", "both", "admin"].includes(ctx.role || "")) return failed("Prepare listing", "Provider access is required. Use the provider application to get started.");
  const nodeId = id(args.node_id);
  const title = typeof args.title === "string" ? args.title.trim().slice(0, 200) : "";
  const description = typeof args.description === "string" ? args.description.slice(0, 2000) : "";
  const proxyType = typeof args.proxy_type === "string" ? args.proxy_type : "";
  const protocol = typeof args.protocol === "string" ? args.protocol.toLowerCase() : "";
  const country = typeof args.country === "string" ? args.country.toUpperCase() : "";
  const pricePerGb = num(args.price_per_gb);
  const availableBandwidthGb = num(args.available_bandwidth_gb);
  const minPurchaseGb = num(args.min_purchase_gb) ?? 0;
  const maxConcurrencyRaw = num(args.max_concurrency);
  const maxConcurrency = maxConcurrencyRaw !== null && Number.isInteger(maxConcurrencyRaw) ? maxConcurrencyRaw : 5;
  if (!nodeId) return failed("Prepare listing", "Use a node id returned by get_my_nodes. A listing must be bound to your node.");
  if (title.length < 5) return failed("Prepare listing", "Give the listing a title of at least 5 characters.");
  if (!PROXY_TYPES.includes(proxyType)) return failed("Prepare listing", `proxy_type must be one of ${PROXY_TYPES.join(", ")}.`);
  if (!PROTOCOLS.includes(protocol)) return failed("Prepare listing", `protocol must be one of ${PROTOCOLS.join(", ")}.`);
  if (country !== "" && !/^[A-Z]{2}$/.test(country)) return failed("Prepare listing", "country must be a two-letter ISO code or empty to use the node's country.");
  if (pricePerGb === null || pricePerGb <= 0 || pricePerGb > 50) return failed("Prepare listing", "price_per_gb must be above 0 and at most $50.");
  if (availableBandwidthGb === null || availableBandwidthGb <= 0 || availableBandwidthGb > 100000) return failed("Prepare listing", "available_bandwidth_gb must be above 0.");
  if (minPurchaseGb < 0 || minPurchaseGb > availableBandwidthGb) return failed("Prepare listing", "min_purchase_gb cannot exceed the available bandwidth.");
  if (maxConcurrency < 1 || maxConcurrency > 100) return failed("Prepare listing", "max_concurrency must be between 1 and 100.");
  const nodesRes = await platformGet(ctx, "/v1/provider/nodes");
  if (!nodesRes.ok || !Array.isArray(nodesRes.body.nodes)) return failed("Prepare listing", "Your provider nodes could not be read to verify ownership.");
  const node = (nodesRes.body.nodes as unknown[]).map(obj).find((n) => id(n.id) === nodeId);
  if (!node) return failed("Prepare listing", "That node is not on your account.");
  const nodeName = str(node.name);
  const draft: ListingDraft = { nodeId, nodeName, title, description, proxyType, protocol, country, pricePerGb, availableBandwidthGb, minPurchaseGb, maxConcurrency };
  const action = ctx.drafts.create(ctx.userId, "create_listing", { listing: draft }, {
    title: `Publish listing — ${title}`,
    summary: [
      `${proxyType} · ${protocol.toUpperCase()} · ${country || "node country"} · $${pricePerGb} / GB`,
      `${availableBandwidthGb} GB available · minimum purchase ${minPurchaseGb} GB · up to ${maxConcurrency} buyers at once`,
      `Bound to your node${nodeName ? ` “${nodeName}”` : ""}. If this deployment requires signed offers, your node will be asked to sign when you approve — keep it running.`,
    ],
    confirmLabel: "Approve & publish",
  });
  return {
    ok: true, label: "Prepared a listing for your approval", action,
    data: { draft_id: action.draftId, prepared: true, executed: false, title, expires_at: action.expiresAt, note: "Nothing has been published. The user must press the approval button on the card; only then is the listing created (with node signing when required)." },
  };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

export async function executeDraft(ctx: PlatformContext & { userId: string; drafts: AssistantDraftStore }, draftId: string): Promise<AssistantActionResult> {
  const draft = ctx.drafts.take(ctx.userId, draftId);
  if (!draft) return { status: "failed", title: "Draft unavailable", message: "That draft has expired, was already used, or belongs to another account. Ask Hubbie to prepare it again." };
  return draft.kind === "buy_order" && draft.buy ? executeBuy(ctx, draft.buy, draft.id) : executeListing(ctx, draft.listing as ListingDraft);
}

async function executeBuy(ctx: PlatformContext, buy: BuyDraft, draftId: string): Promise<AssistantActionResult> {
  // Re-validate the price the user approved against the live listing.
  const check = await platformGet(ctx, `/v1/listings/${buy.listingId}`, false);
  const listing = Object.keys(obj(check.body.listing)).length ? obj(check.body.listing) : check.body;
  if (!check.ok || !id(listing.id)) return { status: "failed", title: "Listing unavailable", message: "That listing could not be read anymore, so no order was created. Search the marketplace again." };
  const livePrice = num(listing.price_per_gb);
  if (livePrice === null || Math.abs(livePrice - buy.priceUsdPerGb) > 0.0001) {
    return { status: "failed", title: "Price changed", message: `The price moved from $${buy.priceUsdPerGb} to $${livePrice ?? "?"} per GB since you reviewed it, so no order was created. Ask Hubbie to prepare the purchase again at the new price.` };
  }
  const created = await platformPost(ctx, "/v1/orders", { listing_id: buy.listingId, bandwidth_gb: buy.bandwidthGb, session_type: buy.sessionType }, { idempotencyKey: `hubbie-${draftId}`, timeoutMs: 30_000 });
  const order = Object.keys(obj(created.body.order)).length ? obj(created.body.order) : created.body;
  const orderId = id(order.id);
  if (!created.ok || !orderId) {
    if (created.status === 0) return { status: "failed", title: "Order outcome unknown", message: "The request timed out, so the order may or may not exist. Check your orders before trying again — do not re-approve blindly.", href: ASSISTANT_DESTINATIONS.orders.href };
    const code = errorCode(created.body);
    const known: Record<string, string> = {
      linked_wallet_required: "Link a Solana wallet first — marketplace payment uses on-chain SOL escrow.",
      self_purchase_forbidden: "You cannot buy your own listing.",
      listing_at_capacity: "That listing is at its buyer capacity right now.",
      plan_bandwidth_quota: "That purchase exceeds your plan's bandwidth quota.",
    };
    return { status: "failed", title: "Order not created", message: (code && known[code]) || "The order could not be created. Open the listing to see its current availability.", href: `/marketplace/${buy.listingId}` };
  }
  const orderHref = `/marketplace/orders/${orderId}`;
  if (buy.payment !== "platform_balance") {
    return { status: "needs_funding", title: "Order created — funding is next", message: `Order for ${buy.bandwidthGb} GB of “${buy.listingTitle}” is pending. Open it to fund the escrow and sign in your wallet; credentials activate after funding.`, href: orderHref };
  }
  const paid = await platformPost(ctx, `/v1/orders/${orderId}/pay/balance`, {}, { timeoutMs: 120_000 });
  if (paid.ok) {
    return { status: "done", title: "Order created and funded", message: `Payment for ${buy.bandwidthGb} GB of “${buy.listingTitle}” is locked in escrow from your ProxyHubb balance. Open the order for your connection credentials.`, href: orderHref };
  }
  const code = errorCode(paid.body);
  const reason = code === "insufficient_balance" ? "your ProxyHubb balance is too low for this order"
    : code === "not_managed_wallet" ? "your primary wallet is not a ProxyHubb managed wallet, so balance payment is unavailable"
    : paid.status === 0 ? "the payment request timed out — check the order status before doing anything else"
    : "the balance payment could not be completed";
  return { status: "needs_funding", title: "Order created — balance payment incomplete", message: `The order exists and is pending, but ${reason}. No duplicate order was made. Open it to fund it another way or cancel it.`, href: orderHref };
}

function listingPayload(draft: ListingDraft): Record<string, unknown> {
  return {
    title: draft.title,
    description: draft.description,
    provider_node_id: draft.nodeId,
    proxy_type: draft.proxyType,
    protocol: draft.protocol,
    country: draft.country,
    price_per_gb: draft.pricePerGb,
    min_purchase_gb: draft.minPurchaseGb,
    available_bandwidth_gb: draft.availableBandwidthGb,
    max_concurrency: draft.maxConcurrency,
  };
}

async function executeListing(ctx: PlatformContext, draft: ListingDraft): Promise<AssistantActionResult> {
  const payload = listingPayload(draft);
  const nodeLabel = draft.nodeName ? `“${draft.nodeName}”` : "your node";
  const policy = await platformGet(ctx, "/v1/listings/proof-policy", false);
  const proofRequired = policy.ok && policy.body.required === true;
  if (proofRequired) {
    const requested = await platformPost(ctx, "/v1/provider/listings/offer-signatures", { listing: payload }, { timeoutMs: 20_000 });
    let view = requested.body;
    if (!requested.ok || !id(view.id)) {
      return { status: "needs_signature", title: "Node signature needed", message: `Hubbie could not ask ${nodeLabel} to sign this offer. Start the node (version 1.0.13 or newer), or finish signing and publishing in the listing editor. Nothing was published.`, href: ASSISTANT_DESTINATIONS.listings.href };
    }
    const started = Date.now();
    let everListening = view.node_listening === true;
    while (true) {
      if (view.status === "signed" && obj(view.proof) && Object.keys(obj(view.proof)).length) { payload.proof = view.proof; break; }
      if (view.status === "refused") {
        return { status: "needs_signature", title: "Node declined to sign", message: `${nodeLabel} declined to sign this offer, so nothing was published. Review the offer in the listing editor.`, href: ASSISTANT_DESTINATIONS.listings.href };
      }
      everListening = everListening || view.node_listening === true;
      const limit = everListening ? 45_000 : 12_000;
      if (ctx.signal.aborted || Date.now() - started >= limit) {
        return { status: "needs_signature", title: "Node signature needed", message: everListening
          ? `${nodeLabel} did not sign in time, so nothing was published. Check it is still running, then try again.`
          : `${nodeLabel} is not connected, so it cannot sign this offer. Start the ProxyHubb app (or provider-node) on that computer and try again. Nothing was published.`, href: ASSISTANT_DESTINATIONS.listings.href };
      }
      await sleep(1500, ctx.signal);
      const polled = await platformGet(ctx, `/v1/provider/listings/offer-signatures/${encodeURIComponent(String(view.id))}`);
      if (polled.status === 404) return { status: "needs_signature", title: "Signing request expired", message: "The signing request expired before the node answered. Ask Hubbie to prepare the listing again. Nothing was published.", href: ASSISTANT_DESTINATIONS.listings.href };
      if (!polled.ok) return { status: "failed", title: "Signing check failed", message: "The node's signature could not be checked, so nothing was published. Try the listing editor.", href: ASSISTANT_DESTINATIONS.listings.href };
      view = polled.body;
    }
  }
  const created = await platformPost(ctx, "/v1/listings", payload, { timeoutMs: 30_000 });
  const listingId = id(created.body.id);
  if (created.ok && listingId) {
    const pending = str(created.body.status, 40) === "pending_review";
    return { status: "done", title: pending ? "Listing submitted for review" : "Listing published", message: pending
      ? `“${draft.title}” was created and is awaiting review before it appears in the marketplace.`
      : `“${draft.title}” is live at $${draft.pricePerGb} / GB.`, href: pending ? ASSISTANT_DESTINATIONS.listings.href : `/marketplace/${listingId}` };
  }
  if (created.status === 403) {
    return { status: "needs_signature", title: "Signature or permission needed", message: "The platform refused this listing (signed-offer or provider permission requirement). Finish it in the listing editor, where the exact requirement is shown. Nothing was published.", href: ASSISTANT_DESTINATIONS.listings.href };
  }
  if (created.status === 0) {
    return { status: "failed", title: "Listing outcome unknown", message: "The request timed out, so the listing may or may not exist. Check your listings before trying again.", href: ASSISTANT_DESTINATIONS.listings.href };
  }
  return { status: "failed", title: "Listing not created", message: "The listing was rejected (for example price bounds, plan listing limits, or a required quality assessment). Open the listing editor to see the exact requirement. Nothing was published.", href: ASSISTANT_DESTINATIONS.listings.href };
}
