package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	catalogsvc "github.com/proxyhubb/control-api/internal/marketplace/catalog"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterCatalogRoutes registers Phase 3A catalog product and offer routes.
func RegisterCatalogRoutes(rg *gin.RouterGroup) {
	rg.GET("/catalog/products/my", getMyCatalogProducts)
	rg.GET("/catalog/sellers/:seller_id/products/:slug", getCatalogProductBySlug)
	rg.GET("/catalog/products/:id", getCatalogProductByID)
	rg.POST("/catalog/products", createCatalogProduct)
	rg.PATCH("/catalog/products/:id", updateCatalogProduct)
	rg.PUT("/catalog/products/:id", updateCatalogProduct)
	rg.POST("/catalog/products/:id/offers", linkCatalogOffer)
	rg.DELETE("/catalog/products/:id/offers/:offer_id", unlinkCatalogOffer)
}

func getMyCatalogProducts(c *gin.Context) {
	sellerID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)

	products, total, err := catalogsvc.ListSellerProducts(sellerID, page, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load catalog products"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"products": products,
		"total":    total,
		"page":     page,
		"limit":    limit,
	})
}

func getCatalogProductBySlug(c *gin.Context) {
	sellerID, err := uuid.Parse(c.Param("seller_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid seller ID"})
		return
	}

	view, err := catalogsvc.GetProductBySellerSlug(sellerID, c.Param("slug"))
	if err != nil {
		writeCatalogError(c, err)
		return
	}

	c.JSON(http.StatusOK, view)
}

func getCatalogProductByID(c *gin.Context) {
	productID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid product ID"})
		return
	}

	var viewer *uuid.UUID
	if id, err := parseUserIDFromContext(c); err == nil {
		viewer = &id
	}

	view, err := catalogsvc.GetProductByID(productID, viewer)
	if err != nil {
		writeCatalogError(c, err)
		return
	}

	c.JSON(http.StatusOK, view)
}

func createCatalogProduct(c *gin.Context) {
	sellerID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var req models.CreateCatalogProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	product, err := catalogsvc.CreateProduct(sellerID, req)
	if err != nil {
		writeCatalogError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{"product": product})
}

func updateCatalogProduct(c *gin.Context) {
	sellerID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	productID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid product ID"})
		return
	}

	var req models.UpdateCatalogProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	product, err := catalogsvc.UpdateProduct(sellerID, productID, req)
	if err != nil {
		writeCatalogError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"product": product})
}

func linkCatalogOffer(c *gin.Context) {
	sellerID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	productID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid product ID"})
		return
	}

	var req models.LinkCatalogOfferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	offer, err := catalogsvc.LinkOffer(sellerID, productID, req)
	if err != nil {
		writeCatalogError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{"offer": offer})
}

func unlinkCatalogOffer(c *gin.Context) {
	sellerID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	productID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid product ID"})
		return
	}
	offerID, err := uuid.Parse(c.Param("offer_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid offer ID"})
		return
	}

	if err := catalogsvc.UnlinkOffer(sellerID, productID, offerID); err != nil {
		writeCatalogError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Offer unlinked"})
}

func writeCatalogError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, catalogsvc.ErrProductNotFound), errors.Is(err, catalogsvc.ErrOfferNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, catalogsvc.ErrListingNotOwned), errors.Is(err, catalogsvc.ErrListingLinked):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, catalogsvc.ErrListingDeleted):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, catalogsvc.ErrSlugTaken):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, catalogsvc.ErrInvalidStatus):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Catalog operation failed"})
	}
}
