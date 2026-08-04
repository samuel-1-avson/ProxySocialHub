# ProxyHubb Go SDK

Official Go client for ProxyHubb Connect (session intents), marketplace credentials, and bulk pools.

## Install

```bash
go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.2.0
```

If the module proxy has not indexed the tag yet, pin the commit or use:

```bash
go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@sdks/go/v0.2.0
```

## Auth

- **API key** (`phub_…`): bulk pools — `X-API-Key`
- **JWT**: session intents + order credentials — `Authorization: Bearer`

## Quick start — Connect

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/samuel-1-avson/ProxySocialHub/sdks/go/proxyhubb"
)

func main() {
	client := proxyhubb.NewClientWithToken("eyJ...") // dashboard JWT
	intent, err := client.CreateSessionIntent(context.Background(), proxyhubb.CreateSessionIntentRequest{
		Type:      "rotating",
		TargetGeo: "US",
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(client.SessionIntentProxyURL(intent.Token))
	// curl -x "http://session-intent:TOKEN@proxy.proxyhubb.com:8090" https://httpbin.org/ip
}
```

## Marketplace credentials

```go
creds, err := client.GetOrderCredentials(ctx, "ORDER_UUID")
url := client.ProxyURLFromCredentials(creds)
```

## Bulk pools

```go
client := proxyhubb.NewClient("phub_...")
pool, err := client.CreatePool(context.Background(), "scrapers", 5)
```

Buyer proxy is HTTP CONNECT / SOCKS5 (`proxy.proxyhubb.com:8090`). See [docs/buyer-proxy.md](../../docs/buyer-proxy.md).

## License

MIT
