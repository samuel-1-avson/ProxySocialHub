package api

import (
	"github.com/proxyhubb/control-api/internal/core/ports"
	"github.com/proxyhubb/control-api/internal/core/services"
	"github.com/proxyhubb/control-api/internal/db"
)

func marketplaceServiceOrDefault() ports.MarketplaceService {
	if svc := GetMarketplaceService(); svc != nil {
		return svc
	}
	return services.NewMarketplaceService(db.NewMarketplaceRepository())
}
