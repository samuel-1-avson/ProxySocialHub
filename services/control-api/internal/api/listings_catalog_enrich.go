package api

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	catalogsvc "github.com/proxyhubb/control-api/internal/marketplace/catalog"
	"github.com/proxyhubb/control-api/internal/models"
)

// includeCatalogProduct reports whether the client asked for catalog_product on listings.
func includeCatalogProduct(c *gin.Context) bool {
	raw := strings.ToLower(strings.TrimSpace(c.Query("include")))
	if raw == "" {
		return false
	}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		switch part {
		case "product", "catalog", "catalog_product":
			return true
		}
	}
	return false
}

// includeCatalogMap reports whether map points should embed catalog_product on listing pins.
func includeCatalogMap(c *gin.Context) bool {
	if includeCatalogProduct(c) {
		return true
	}
	raw := strings.ToLower(strings.TrimSpace(c.Query("include_catalog")))
	return raw == "1" || raw == "true" || raw == "yes"
}

func catalogViewerFromContext(c *gin.Context) *uuid.UUID {
	if id, err := parseUserIDFromContext(c); err == nil {
		return &id
	}
	return nil
}

func maybeEnrichListingsWithCatalog(c *gin.Context, listings []models.ProxyListing) {
	if !includeCatalogProduct(c) {
		return
	}
	_ = catalogsvc.EnrichListingsWithCatalogProducts(listings, catalogViewerFromContext(c))
}
