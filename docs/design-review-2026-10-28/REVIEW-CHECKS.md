# Revision 2 specimen checks

Checked 28 October 2026. These results concern the standalone design artifacts, not the deployed product.

## Completed checks

| Check | Result |
|---|---|
| JavaScript syntax | `theme.js`, `concept-base.js`, `concept-v2.js`, and `explorer.js` parsed successfully |
| Source evidence | All 49 feature-inventory source paths exist |
| Route coverage | 100 current page files mapped; 25 assigned to the proposed standalone explorer |
| Workspace navigation | Four primary destinations in Buyer and Seller; desktop and mobile workspace switching exercised |
| Theme switching | Dark and Light render in browser; Light persists after reload; System option is present |
| Local cross-tab theme | Changing Explorer to Dark updates the open workspace through same-origin storage events |
| Quantity / quote preview | Germany offer at 10 GB displays $4.80 and 0.032000 example SOL at the explicitly invented conversion |
| Funded but delayed access | Keeps example order PH-1043 and offers recovery without another funding step |
| Recovery preview | Transitions the same example order to ready access |
| Additional filters | Maximum $0.50/GB returns only the $0.48 Germany example |
| Offer comparison | Two selected offers display price, latency/unknown meaning, and review context |
| Guided seller setup | All four stages opened; explicit heartbeat preview shows that no real node was contacted |
| Listing draft | Example draft saved in local page state and displayed as not published |
| Settings | Profile and Appearance sections opened; Appearance controls the shared preview theme |
| Mobile utilities | Account menu exposes Buyer/Seller, Settings, Inbox, Help and standalone Explorer link |
| Explorer separation | Own header and five destinations; no wallet controls in the inspected DOM |
| Typed search | `demo-block-2814` finds an example Block and opens its distinct detail on the Blocks subview |
| Governance handoff | Public Explorer participation link opens application preview with proposal context and no signing |
| Narrow layout | At 320 px, sampled workspace Overview/Listings and Explorer Overview had document width ≤ viewport width |
| Table access | Wide tables use a named, focusable scroll region rather than forcing document-wide horizontal scrolling |
| Viewport cleanup | Temporary browser viewport override reset after review |

The System option's live response to an operating-system preference change was not exercised. The preview code subscribes to that event; production validation still needs to cover it. The specimen's complete set of dialogs, every flow variant, all keyboard paths, screen readers, zoom and production browser combinations were not exhaustively tested.

## Static token contrast calculations

Ratios were calculated from the specified opaque RGB pairs. They do not include every component, font treatment, transparency, chart, focus state or background combination.

| Pair | Ratio | Reference threshold used |
|---|---:|---:|
| Light primary text / canvas | 12.07:1 | 4.5:1 |
| Light secondary text / white | 6.27:1 | 4.5:1 |
| Light button label / primary action | 5.52:1 | 4.5:1 |
| Light essential input boundary / white | 3.71:1 | 3:1 |
| Dark primary text / canvas | 15.57:1 | 4.5:1 |
| Dark secondary text / surface | 8.78:1 | 4.5:1 |
| Dark button label / primary action | 8.11:1 | 4.5:1 |
| Dark essential input boundary / surface | 3.20:1 | 3:1 |

These checks support design review. They are not a WCAG conformance claim.

## Not performed

No production application build/E2E suite, live checkout, wallet signing, payout, actual SDK request, extension pairing, secret creation/revocation, message delivery, security mutation, account update, DNS/hosting change or domain deployment was performed. Maps and charts use labeled example data. Production performance and separate-origin behavior remain implementation gates.
