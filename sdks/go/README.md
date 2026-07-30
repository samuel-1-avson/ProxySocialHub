# ProxyHubb Go SDK

Official Go client for the ProxyHubb Bulk Proxy Pool API.

## Install

```bash
go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.1.0
```

## Usage

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/samuel-1-avson/ProxySocialHub/sdks/go/proxyhubb"
)

func main() {
	client := proxyhubb.NewClient("phub_...") // default: https://api.proxyhubb.com
	pool, err := client.CreatePool(context.Background(), "scrapers", 5)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(pool.ID)
}
```

Auth: `X-API-Key` with a `phub_` (or `pk_`) key from the dashboard.

## License

MIT
