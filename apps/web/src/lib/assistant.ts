/** Shared, serializable assistant contracts and reviewed product knowledge. */
export interface AssistantMessage { role: "user" | "assistant"; content: string }
export interface AssistantSource { title: string; href: string }
export interface AssistantStep { label: string; ok: boolean }
/** A server-prepared action the user must still approve. Drafts do nothing until approved. */
export interface AssistantAction {
  draftId: string;
  kind: "buy_order" | "create_listing";
  title: string;
  summary: string[];
  confirmLabel: string;
  expiresAt: string;
}
export interface AssistantActionResult {
  status: "done" | "needs_funding" | "needs_signature" | "failed";
  title: string;
  message: string;
  href?: string;
}
export interface AssistantReply {
  mode: "ai" | "guides";
  content: string;
  sources: AssistantSource[];
  steps: AssistantStep[];
  actions?: AssistantAction[];
}
export type AssistantEvent =
  | { type: "status"; label: string }
  | { type: "step"; step: AssistantStep }
  | { type: "delta"; text: string }
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

// BIP39 English wordlist (public-domain spec text, bitcoin/bips bip-0039), used
// only to recognize pasted recovery phrases so they never reach the model.
const BIP39_WORDS = new Set("abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert alien all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor army around arrange arrest arrive arrow art artefact artist artwork ask aspect assault asset assist assume asthma athlete atom attack attend attitude attract auction audit august aunt author auto autumn average avocado avoid awake aware away awesome awful awkward axis baby bachelor bacon badge bag balance balcony ball bamboo banana banner bar barely bargain barrel base basic basket battle beach bean beauty because become beef before begin behave behind believe below belt bench benefit best betray better between beyond bicycle bid bike bind biology bird birth bitter black blade blame blanket blast bleak bless blind blood blossom blouse blue blur blush board boat body boil bomb bone bonus book boost border boring borrow boss bottom bounce box boy bracket brain brand brass brave bread breeze brick bridge brief bright bring brisk broccoli broken bronze broom brother brown brush bubble buddy budget buffalo build bulb bulk bullet bundle bunker burden burger burst bus business busy butter buyer buzz cabbage cabin cable cactus cage cake call calm camera camp can canal cancel candy cannon canoe canvas canyon capable capital captain car carbon card cargo carpet carry cart case cash casino castle casual cat catalog catch category cattle caught cause caution cave ceiling celery cement census century cereal certain chair chalk champion change chaos chapter charge chase chat cheap check cheese chef cherry chest chicken chief child chimney choice choose chronic chuckle chunk churn cigar cinnamon circle citizen city civil claim clap clarify claw clay clean clerk clever click client cliff climb clinic clip clock clog close cloth cloud clown club clump cluster clutch coach coast coconut code coffee coil coin collect color column combine come comfort comic common company concert conduct confirm congress connect consider control convince cook cool copper copy coral core corn correct cost cotton couch country couple course cousin cover coyote crack cradle craft cram crane crash crater crawl crazy cream credit creek crew cricket crime crisp critic crop cross crouch crowd crucial cruel cruise crumble crunch crush cry crystal cube culture cup cupboard curious current curtain curve cushion custom cute cycle dad damage damp dance danger daring dash daughter dawn day deal debate debris decade december decide decline decorate decrease deer defense define defy degree delay deliver demand demise denial dentist deny depart depend deposit depth deputy derive describe desert design desk despair destroy detail detect develop device devote diagram dial diamond diary dice diesel diet differ digital dignity dilemma dinner dinosaur direct dirt disagree discover disease dish dismiss disorder display distance divert divide divorce dizzy doctor document dog doll dolphin domain donate donkey donor door dose double dove draft dragon drama drastic draw dream dress drift drill drink drip drive drop drum dry duck dumb dune during dust dutch duty dwarf dynamic eager eagle early earn earth easily east easy echo ecology economy edge edit educate effort egg eight either elbow elder electric elegant element elephant elevator elite else embark embody embrace emerge emotion employ empower empty enable enact end endless endorse enemy energy enforce engage engine enhance enjoy enlist enough enrich enroll ensure enter entire entry envelope episode equal equip era erase erode erosion error erupt escape essay essence estate eternal ethics evidence evil evoke evolve exact example excess exchange excite exclude excuse execute exercise exhaust exhibit exile exist exit exotic expand expect expire explain expose express extend extra eye eyebrow fabric face faculty fade faint faith fall false fame family famous fan fancy fantasy farm fashion fat fatal father fatigue fault favorite feature february federal fee feed feel female fence festival fetch fever few fiber fiction field figure file film filter final find fine finger finish fire firm first fiscal fish fit fitness fix flag flame flash flat flavor flee flight flip float flock floor flower fluid flush fly foam focus fog foil fold follow food foot force forest forget fork fortune forum forward fossil foster found fox fragile frame frequent fresh friend fringe frog front frost frown frozen fruit fuel fun funny furnace fury future gadget gain galaxy gallery game gap garage garbage garden garlic garment gas gasp gate gather gauge gaze general genius genre gentle genuine gesture ghost giant gift giggle ginger giraffe girl give glad glance glare glass glide glimpse globe gloom glory glove glow glue goat goddess gold good goose gorilla gospel gossip govern gown grab grace grain grant grape grass gravity great green grid grief grit grocery group grow grunt guard guess guide guilt guitar gun gym habit hair half hammer hamster hand happy harbor hard harsh harvest hat have hawk hazard head health heart heavy hedgehog height hello helmet help hen hero hidden high hill hint hip hire history hobby hockey hold hole holiday hollow home honey hood hope horn horror horse hospital host hotel hour hover hub huge human humble humor hundred hungry hunt hurdle hurry hurt husband hybrid ice icon idea identify idle ignore ill illegal illness image imitate immense immune impact impose improve impulse inch include income increase index indicate indoor industry infant inflict inform inhale inherit initial inject injury inmate inner innocent input inquiry insane insect inside inspire install intact interest into invest invite involve iron island isolate issue item ivory jacket jaguar jar jazz jealous jeans jelly jewel job join joke journey joy judge juice jump jungle junior junk just kangaroo keen keep ketchup key kick kid kidney kind kingdom kiss kit kitchen kite kitten kiwi knee knife knock know lab label labor ladder lady lake lamp language laptop large later latin laugh laundry lava law lawn lawsuit layer lazy leader leaf learn leave lecture left leg legal legend leisure lemon lend length lens leopard lesson letter level liar liberty library license life lift light like limb limit link lion liquid list little live lizard load loan lobster local lock logic lonely long loop lottery loud lounge love loyal lucky luggage lumber lunar lunch luxury lyrics machine mad magic magnet maid mail main major make mammal man manage mandate mango mansion manual maple marble march margin marine market marriage mask mass master match material math matrix matter maximum maze meadow mean measure meat mechanic medal media melody melt member memory mention menu mercy merge merit merry mesh message metal method middle midnight milk million mimic mind minimum minor minute miracle mirror misery miss mistake mix mixed mixture mobile model modify mom moment monitor monkey monster month moon moral more morning mosquito mother motion motor mountain mouse move movie much muffin mule multiply muscle museum mushroom music must mutual myself mystery myth naive name napkin narrow nasty nation nature near neck need negative neglect neither nephew nerve nest net network neutral never news next nice night noble noise nominee noodle normal north nose notable note nothing notice novel now nuclear number nurse nut oak obey object oblige obscure observe obtain obvious occur ocean october odor off offer office often oil okay old olive olympic omit once one onion online only open opera opinion oppose option orange orbit orchard order ordinary organ orient original orphan ostrich other outdoor outer output outside oval oven over own owner oxygen oyster ozone pact paddle page pair palace palm panda panel panic panther paper parade parent park parrot party pass patch path patient patrol pattern pause pave payment peace peanut pear peasant pelican pen penalty pencil people pepper perfect permit person pet phone photo phrase physical piano picnic picture piece pig pigeon pill pilot pink pioneer pipe pistol pitch pizza place planet plastic plate play please pledge pluck plug plunge poem poet point polar pole police pond pony pool popular portion position possible post potato pottery poverty powder power practice praise predict prefer prepare present pretty prevent price pride primary print priority prison private prize problem process produce profit program project promote proof property prosper protect proud provide public pudding pull pulp pulse pumpkin punch pupil puppy purchase purity purpose purse push put puzzle pyramid quality quantum quarter question quick quit quiz quote rabbit raccoon race rack radar radio rail rain raise rally ramp ranch random range rapid rare rate rather raven raw razor ready real reason rebel rebuild recall receive recipe record recycle reduce reflect reform refuse region regret regular reject relax release relief rely remain remember remind remove render renew rent reopen repair repeat replace report require rescue resemble resist resource response result retire retreat return reunion reveal review reward rhythm rib ribbon rice rich ride ridge rifle right rigid ring riot ripple risk ritual rival river road roast robot robust rocket romance roof rookie room rose rotate rough round route royal rubber rude rug rule run runway rural sad saddle sadness safe sail salad salmon salon salt salute same sample sand satisfy satoshi sauce sausage save say scale scan scare scatter scene scheme school science scissors scorpion scout scrap screen script scrub sea search season seat second secret section security seed seek segment select sell seminar senior sense sentence series service session settle setup seven shadow shaft shallow share shed shell sheriff shield shift shine ship shiver shock shoe shoot shop short shoulder shove shrimp shrug shuffle shy sibling sick side siege sight sign silent silk silly silver similar simple since sing siren sister situate six size skate sketch ski skill skin skirt skull slab slam sleep slender slice slide slight slim slogan slot slow slush small smart smile smoke smooth snack snake snap sniff snow soap soccer social sock soda soft solar soldier solid solution solve someone song soon sorry sort soul sound soup source south space spare spatial spawn speak special speed spell spend sphere spice spider spike spin spirit split spoil sponsor spoon sport spot spray spread spring spy square squeeze squirrel stable stadium staff stage stairs stamp stand start state stay steak steel stem step stereo stick still sting stock stomach stone stool story stove strategy street strike strong struggle student stuff stumble style subject submit subway success such sudden suffer sugar suggest suit summer sun sunny sunset super supply supreme sure surface surge surprise surround survey suspect sustain swallow swamp swap swarm swear sweet swift swim swing switch sword symbol symptom syrup system table tackle tag tail talent talk tank tape target task taste tattoo taxi teach team tell ten tenant tennis tent term test text thank that theme then theory there they thing this thought three thrive throw thumb thunder ticket tide tiger tilt timber time tiny tip tired tissue title toast tobacco today toddler toe together toilet token tomato tomorrow tone tongue tonight tool tooth top topic topple torch tornado tortoise toss total tourist toward tower town toy track trade traffic tragic train transfer trap trash travel tray treat tree trend trial tribe trick trigger trim trip trophy trouble truck true truly trumpet trust truth try tube tuition tumble tuna tunnel turkey turn turtle twelve twenty twice twin twist two type typical ugly umbrella unable unaware uncle uncover under undo unfair unfold unhappy uniform unique unit universe unknown unlock until unusual unveil update upgrade uphold upon upper upset urban urge usage use used useful useless usual utility vacant vacuum vague valid valley valve van vanish vapor various vast vault vehicle velvet vendor venture venue verb verify version very vessel veteran viable vibrant vicious victory video view village vintage violin virtual virus visa visit visual vital vivid vocal voice void volcano volume vote voyage wage wagon wait walk wall walnut want warfare warm warrior wash wasp waste water wave way wealth weapon wear weasel weather web wedding weekend weird welcome west wet whale what wheat wheel when where whip whisper wide width wife wild will win window wine wing wink winner winter wire wisdom wise wish witness wolf woman wonder wood wool word work world worry worth wrap wreck wrestle wrist write wrong yard year yellow you young youth zebra zero zone zoo".split(" "));
const MNEMONIC_LENGTHS = [24, 21, 18, 15, 12];

/** Replace any 12/15/18/21/24-word run drawn entirely from the BIP39 list. */
export function redactMnemonics(text: string): string {
  const tokens = [...text.matchAll(/[A-Za-z]+/g)].map((m) => ({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length }));
  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = 0;
    for (const length of MNEMONIC_LENGTHS) {
      if (i + length > tokens.length) continue;
      let ok = true;
      for (let j = 0; j < length; j++) {
        const t = tokens[i + j];
        // Words must be separated only by whitespace, so ordinary prose with
        // punctuation between words is never treated as a phrase.
        if (!BIP39_WORDS.has(t.word) || (j > 0 && !/^[\s,;]+$/.test(text.slice(tokens[i + j - 1].end, t.start)))) { ok = false; break; }
      }
      if (ok) { matched = length; break; }
    }
    if (matched) { spans.push([tokens[i].start, tokens[i + matched - 1].end]); i += matched; } else i++;
  }
  if (!spans.length) return text;
  let out = "";
  let at = 0;
  for (const [start, end] of spans) { out += text.slice(at, start) + "[redacted seed phrase]"; at = end; }
  return out + text.slice(at);
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\b(?:phub_|pt_|sk-|sk_)[A-Za-z0-9_-]{12,}/g, "[redacted key]"],
  [/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted private key]"],
  [/\b(password|api[_ -]?key|secret|seed[_ -]?phrase|mnemonic|private[_ -]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1: [redacted]"],
  [/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]"],
  // Base58 strings of secret-key length (a 64-byte Solana secret encodes to
  // 87-88 chars; transaction signatures are the same length and the model has
  // no use for either). Public addresses (32-44 chars) are left alone.
  [/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/g, "[redacted key]"],
  // JSON keypair byte arrays, e.g. a pasted Solana id.json secret.
  [/\[\s*\d{1,3}(?:\s*,\s*\d{1,3}){31,}\s*\]/g, "[redacted key]"],
  [/\b0x[0-9a-fA-F]{64,128}\b/g, "[redacted key]"],
];

export function redactAssistantSecrets(text: string, known: string[] = []): string {
  let result = redactMnemonics(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) result = result.replace(pattern, replacement);
  for (const secret of known.filter((value) => value.length >= 8)) result = result.split(secret).join("[redacted]");
  return result;
}

/** True when text looks like a credential a user should never send in chat. */
export function containsLikelySecret(text: string): boolean {
  if (redactMnemonics(text) !== text) return true;
  return SECRET_PATTERNS.some(([pattern]) => { pattern.lastIndex = 0; return pattern.test(text); });
}
