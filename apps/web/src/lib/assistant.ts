/** Shared, serializable assistant contracts and reviewed product knowledge. */
export interface AssistantMessage { role: "user" | "assistant"; content: string }
export interface AssistantSource { title: string; href: string }
export interface AssistantStep { label: string; ok: boolean }
export interface AssistantReply {
  mode: "ai" | "guides";
  content: string;
  sources: AssistantSource[];
  steps: AssistantStep[];
}
export type AssistantEvent =
  | { type: "status"; label: string }
  | { type: "step"; step: AssistantStep }
  | { type: "reply"; reply: AssistantReply }
  | { type: "error"; message: string };

export const ASSISTANT_DESTINATIONS = {
  marketplace: { title: "Browse proxy listings", href: "/marketplace" },
  orders: { title: "Review your orders", href: "/marketplace/orders" },
  connections: { title: "Open Connections", href: "/app/connections" },
  wallet: { title: "Open your wallet", href: "/app/wallet" },
  provider_setup: { title: "Become a provider", href: "/dashboard/become-provider" },
  nodes: { title: "Manage provider nodes", href: "/provider/nodes" },
  listings: { title: "Manage your listings", href: "/provider/listings" },
  earnings: { title: "View provider earnings", href: "/provider/earnings" },
  audits: { title: "Open Regional Auditor", href: "/app/audits" },
  settings: { title: "Account settings", href: "/app/settings" },
  support: { title: "Contact support", href: "/help/contact" },
  docs: { title: "Technical documentation", href: "https://docs.proxyhubb.com" },
} satisfies Record<string, AssistantSource>;

export const ASSISTANT_GUIDES = [
  {
    id: "buy", title: "Find and buy proxy bandwidth", href: "/marketplace",
    keywords: "buy buying purchase find search compare cheapest cheap price pricing proxy proxies bandwidth residential mobile datacenter country region socks http listing marketplace",
    content: "Browse the marketplace and filter by country, proxy type, protocol, and price. Open a listing to review available bandwidth, minimum purchase, status, and the source of its quality measurements. Review the order and network before approving payment in your wallet. Advertised location and unmeasured health are not verified exit evidence.",
  },
  {
    id: "connect", title: "Connect a purchased proxy", href: "/app/connections",
    keywords: "connect connection configure configuration setup browser extension credentials credential password authentication 407 socks5 curl python sdk node integration proxy failed timeout error troubleshoot",
    content: "Check that your order is active and funded, then open its order page for credentials. Use Connections for integration instructions. Buyer traffic uses HTTP CONNECT / SOCKS5 through proxy.proxyhubb.com:8090. For a 407 error, check the order credentials and expiry; for timeouts, check order status, gateway reachability, and provider availability. Never paste proxy passwords, session tokens, API keys, seed phrases, or private keys into chat.",
  },
  {
    id: "orders", title: "Understand orders and escrow", href: "/marketplace/orders",
    keywords: "order orders active pending expired cancelled canceled refund refunding payment paid escrow transaction settlement settle funded fund stuck missing failed",
    content: "Open Orders to inspect the current status and any recovery action. A purchase locks funds in a Solana escrow. Settlement pays for metered usage and refunds the unused remainder; terminal escrow closure returns its rent reserve. The assistant can read order summaries when you sign in, but payment, cancellation, recovery, and signatures must be reviewed in the existing order and wallet flows. A missing transaction confirmation is not proof of payment.",
  },
  {
    id: "wallet", title: "Wallet and network setup", href: "/app/wallet",
    keywords: "wallet sol solana phantom solflare balance network devnet testnet mainnet signature signing funds deposit transfer money",
    content: "Connect a supported Solana wallet and follow the network displayed by the platform. The testnet deployment uses Devnet and test SOL only; do not send mainnet funds to it. Check the selected network and balance before funding an order. The assistant cannot sign transactions or access your seed phrase. Keep seed phrases and private keys in your wallet only.",
  },
  {
    id: "provider", title: "Start providing bandwidth", href: "/dashboard/become-provider",
    keywords: "provider seller sell selling earn earning earnings income share bandwidth onboarding application become start daemon cli install node nodes heartbeat offline online publish listing",
    content: "Start with the provider application, then use the provider workspace to register a node and follow its setup instructions. Run the provider daemon, verify heartbeats and capacity, and create a listing linked to the node. Review readiness and measured quality before publishing. Earnings depend on real usage and settlement; a listed node is not a guarantee of demand or income.",
  },
  {
    id: "audits", title: "Check a website across regions", href: "/app/audits",
    keywords: "audit audits auditor regional website localization region evidence screenshot capture inspect geo verify country",
    content: "Open Regional Auditor to select a target website, regions, and expectations. A live audit needs usable proxy sessions for those regions; a funded marketplace order can provide one. Read the evidence and exit verification for each region. Fixture runs use synthetic evidence, and an unavailable region must remain unavailable. Starting an audit is a separate action in the auditor workflow.",
  },
  {
    id: "account", title: "Account access and settings", href: "/app/settings",
    keywords: "account login sign signin authentication profile security preferences notification api key keys settings logout session",
    content: "Sign in through the platform's login flow to use account-specific assistance. Open Account settings for profile, security, and preferences. Use the relevant workspace credential screen to manage keys. Never send secret values to the assistant. If your session expires, sign in again before retrying an account check.",
  },
  {
    id: "support", title: "Get help from the team", href: "/help/contact",
    keywords: "human help support contact bug problem issue dispute report team ticket",
    content: "Contact support with a description of the issue and the affected listing, order, or session reference. Include the visible status and error message, but remove passwords, tokens, API keys, private keys, and seed phrases. Public product questions can also be discussed in the Help forum. The assistant does not send support messages or create tickets.",
  },
] as const;

const STOP_WORDS = new Set("a an and are can do for from help how i in is it me my of on please the to want what with you your".split(" "));
export function searchAssistantGuides(query: string) {
  const words = [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w)))];
  return ASSISTANT_GUIDES.map((guide) => ({ guide, score: words.reduce((score, word) => score + (`${guide.title} ${guide.keywords}`.toLowerCase().split(/\s+/).includes(word) ? 1 : 0), 0) }))
    .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(({ guide }) => guide);
}

/** No model is involved in this deliberately labelled fallback. */
export function assistantGuideReply(query: string): AssistantReply {
  const matches = searchAssistantGuides(query);
  return {
    mode: "guides",
    content: matches.length
      ? matches.map((g) => `**${g.title}**\n\n${g.content}`).join("\n\n")
      : "I can help you find guides for buying proxies, connecting an order, wallet setup, provider nodes, and regional audits. Describe which of these you need, or contact support for an account-specific issue. Guide mode does not check your account or live availability.",
    sources: matches.length ? matches.map(({ title, href }) => ({ title, href })) : [ASSISTANT_DESTINATIONS.support],
    steps: [{ label: "Searched ProxyHubb help guides", ok: true }],
  };
}

export function safeAssistantHref(href: string): boolean {
  if (Object.values(ASSISTANT_DESTINATIONS).some((d) => d.href === href)) return true;
  if (/^\/(?:marketplace(?:\/orders)?|provider\/nodes)\/[a-zA-Z0-9_-]{1,80}$/.test(href)) return true;
  return false;
}

export function redactAssistantSecrets(text: string, known: string[] = []): string {
  let result = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:phub_|pt_|sk-|sk_)[A-Za-z0-9_-]{12,}/g, "[redacted key]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\b(password|api[_ -]?key|secret|seed[_ -]?phrase|private[_ -]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1: [redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]");
  for (const secret of known.filter((value) => value.length >= 8)) result = result.split(secret).join("[redacted]");
  return result;
}
