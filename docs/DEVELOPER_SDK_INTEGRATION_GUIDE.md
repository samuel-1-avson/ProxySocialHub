# ProxyHubb Developer SDK Integration Guide

**Languages**: Node.js / TypeScript, Python, Go  
**Target Audience**: Application Developers, Web Scraping Engineers, AI Agent Builders, and DePIN Operators  
**Version**: 0.3.0  

---

## 1. Installation

| Language / Platform | Package Name | Install Command |
| :--- | :--- | :--- |
| **Node.js / TypeScript** | `@proxyhubb/sdk` | `npm install @proxyhubb/sdk` |
| **Python** | `proxyhubb` | `pip install proxyhubb` |
| **Go** | `sdks/go` | `go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.3.0` |

---

## 2. Authentication Model

ProxyHubb uses two authentication modes depending on whether you are a **Buyer** or **Provider/Seller**:

| Role | Credential Type | Header Used | Permitted APIs |
| :--- | :--- | :--- | :--- |
| **Buyer (Bulk Pools)** | API Key (`phub_live_...`) | `X-API-Key` | Bulk pool proxy routing, order credential retrieval |
| **Buyer (Connect / Intents)** | Dashboard JWT | `Authorization: Bearer <JWT>` | Dynamic session intents, on-demand rotating proxy tokens |
| **Seller / Provider** | Provider Token (`ptok_...`) | `Authorization: Bearer <TOKEN>` | Node management, marketplace listings, live earnings queries |

---

## 3. Buyer Integrations (Web Scraping & AI Agents)

### A. TypeScript / Node.js with Axios & Playwright

```typescript
import { ProxyHubClient } from '@proxyhubb/sdk';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { chromium } from 'playwright';

const client = new ProxyHubClient({
  accessToken: process.env.PROXYHUBB_JWT_TOKEN!,
});

async function runScraper() {
  // 1. Generate an on-demand residential proxy session intent for the US
  const session = await client.createSessionIntent({
    sessionType: 'rotating',
    targetGeo: 'US',
  });

  console.log(`Generated Intent Token: ${session.token} (Expires: ${session.expires_at})`);

  // 2. HTTP Request via Axios
  const proxyUrl = `http://session-intent:${session.token}@proxy.proxyhubb.com:8090`;
  const agent = new HttpsProxyAgent(proxyUrl);

  const response = await axios.get('https://api.ipify.org?format=json', {
    httpsAgent: agent,
  });
  console.log(`Egress IP via ProxyHubb: ${response.data.ip}`);

  // 3. Headless Browser Automation via Playwright
  const browser = await chromium.launch({
    proxy: {
      server: 'http://proxy.proxyhubb.com:8090',
      username: 'session-intent',
      password: session.token,
    },
  });

  const page = await browser.newPage();
  await page.goto('https://proxyhubb.com/explorer');
  console.log(`Page Title: ${await page.title()}`);
  await browser.close();
}

runScraper().catch(console.error);
```

---

### B. Python with `requests` & `httpx`

```python
import os
import requests
import httpx
from proxyhubb import ProxyHubClient, as_requests_proxies

# 1. Initialize client
client = ProxyHubClient(access_token=os.environ["PROXYHUBB_JWT_TOKEN"])

# 2. Create session intent
session = client.create_session_intent(
    session_type="sticky",
    target_geo="DE",
    duration_minutes=30
)

# 3. Format requests-compatible proxy dictionary
proxy_url = f"http://session-intent:{session['token']}@proxy.proxyhubb.com:8090"
proxies = as_requests_proxies(proxy_url)

# 4. Perform HTTP request
resp = requests.get("https://httpbin.org/ip", proxies=proxies, timeout=10)
print("Assigned German IP:", resp.json()["origin"])

# 5. Async HTTP with HTTPX
async def run_async_scrape():
    async with httpx.AsyncClient(proxies=proxy_url) as async_client:
        r = await async_client.get("https://api.ipify.org?format=json")
        print("Async IP:", r.json()["ip"])
```

---

### C. Go HTTP Client

```go
package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"

	"github.com/samuel-1-avson/ProxySocialHub/sdks/go/proxyhubb"
)

func main() {
	ctx := context.Background()
	client := proxyhubb.NewClientWithToken(os.Getenv("PROXYHUBB_JWT_TOKEN"))

	// 1. Create session intent
	intent, err := client.CreateSessionIntent(ctx, proxyhubb.SessionIntentRequest{
		Type:      "rotating",
		TargetGeo: "US",
	})
	if err != nil {
		panic(err)
	}

	// 2. Configure HTTP transport proxy
	proxyURL, _ := url.Parse(fmt.Sprintf("http://session-intent:%s@proxy.proxyhubb.com:8090", intent.Token))
	httpClient := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
	}

	// 3. Execute request
	resp, err := httpClient.Get("https://api.ipify.org")
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("Egress IP: %s\n", string(body))
}
```

---

## 4. Provider & Seller Automation

Automate node registration, marketplace pricing, and earnings tracking programmatically:

```typescript
import { ProxyHubClient } from '@proxyhubb/sdk';

const seller = new ProxyHubClient({
  providerToken: process.env.PROXYHUBB_PROVIDER_TOKEN!,
});

async function manageNodes() {
  // 1. Fetch connected provider nodes
  const nodes = await seller.listProviderNodes();
  console.log(`Active Nodes: ${nodes.length}`);

  // 2. Query Real-Time Earnings Summary
  const earnings = await seller.getEarningsSummary();
  console.log(`Total Earned: ${earnings.total_earnings_sol} SOL (${earnings.total_bytes_served} bytes)`);

  // 3. Create or update bandwidth marketplace listing
  const listing = await seller.createListing({
    title: 'High-Speed Residential Node (Frankfurt)',
    priceLamportsPerGb: 5_000_000, // 0.005 SOL per GB
    targetGeo: 'DE',
    connectionType: 'residential',
    bandwidthMbps: 250,
  });
  console.log(`Listing published: ${listing.id}`);
}

manageNodes().catch(console.error);
```

---

## 5. Error Handling & Best Practices

1. **Automatic Token Expiry Handling**: Catch `401 Unauthorized` errors and refresh the session intent token using `createSessionIntent`.
2. **Timeout Invariants**: Set network request timeouts between `5s` and `15s` to allow the Edge Gateway to perform dynamic NAT traversal and peer failover.
3. **Geo-Targeting Fallback**: If a specific city is unavailable, specify the country code (e.g. `US`, `DE`, `GB`) to maximize node pool depth.
