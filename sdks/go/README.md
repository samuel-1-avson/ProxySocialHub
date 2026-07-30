# ProxyHubb Go SDK

```bash
go get github.com/proxyhubb/sdk-go@latest
```

```go
import (
  "context"
  "github.com/proxyhubb/sdk-go/proxyhubb"
)

client := proxyhubb.NewClient("phub_...")
pool, err := client.CreatePool(context.Background(), "scrapers", 5)
```

Default API host: `https://api.proxyhubb.com`.

## License

MIT
