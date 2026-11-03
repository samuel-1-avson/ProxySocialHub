package api

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"io"
	"net/http"
	"time"
)

type privacySettings struct {
	ProfilePublic          bool       `json:"profile_public"`
	Discoverable           bool       `json:"discoverable"`
	MapVisible             bool       `json:"map_visible"`
	MapPrecision           string     `json:"map_precision"`
	PresenceVisible        bool       `json:"presence_visible"`
	ActivityPublic         bool       `json:"activity_public"`
	ContactMode            string     `json:"contact_mode"`
	AnalyticsOptIn         bool       `json:"analytics_opt_in"`
	AllowDirectConnections bool       `json:"allow_direct_connections"`
	PublicChainConsent     bool       `json:"public_chain_consent"`
	UpdatedAt              *time.Time `json:"updated_at"`
}

func privacyFrom(u models.User) privacySettings {
	p := privacySettings{u.ProfilePublic, u.Discoverable, u.MapVisible, u.MapPrecision, u.PresenceVisible, u.ActivityPublic, u.ContactMode, u.AnalyticsOptIn, u.AllowDirectConnections, u.PublicChainConsent, u.PrivacyUpdatedAt}
	if p.MapPrecision == "" {
		p.MapPrecision = "country"
	}
	if p.ContactMode == "" {
		p.ContactMode = "contacts"
	}
	return p
}

func RegisterPrivacyRoutes(r *gin.RouterGroup) {
	r.GET("/profile/privacy", getPrivacySettings)
	r.PUT("/profile/privacy", updatePrivacySettings)
	r.GET("/profile/privacy/preview", previewPrivacy)
	r.PATCH("/listings/:id/contact", updateListingContact)
}

func privacyUser(c *gin.Context) (models.User, bool) {
	uid, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return models.User{}, false
	}
	var u models.User
	if err := db.DB.First(&u, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Account not found"})
		return u, false
	}
	c.Header("Cache-Control", "no-store")
	return u, true
}

func getPrivacySettings(c *gin.Context) {
	u, ok := privacyUser(c)
	if ok {
		c.JSON(http.StatusOK, privacyFrom(u))
	}
}

func updatePrivacySettings(c *gin.Context) {
	u, ok := privacyUser(c)
	if !ok {
		return
	}
	var req struct {
		ProfilePublic              *bool   `json:"profile_public"`
		Discoverable               *bool   `json:"discoverable"`
		MapVisible                 *bool   `json:"map_visible"`
		MapPrecision               *string `json:"map_precision"`
		PresenceVisible            *bool   `json:"presence_visible"`
		ActivityPublic             *bool   `json:"activity_public"`
		ContactMode                *string `json:"contact_mode"`
		AnalyticsOptIn             *bool   `json:"analytics_opt_in"`
		AllowDirectConnections     *bool   `json:"allow_direct_connections"`
		PublicChainConsent         *bool   `json:"public_chain_consent"`
		AcknowledgeIPDisclosure    bool    `json:"acknowledge_ip_disclosure"`
		AcknowledgeChainDisclosure bool    `json:"acknowledge_chain_disclosure"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&req) != nil || decoder.Decode(new(interface{})) != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid privacy settings"})
		return
	}
	updates := map[string]interface{}{"privacy_updated_at": time.Now().UTC()}
	for name, p := range map[string]*bool{"profile_public": req.ProfilePublic, "discoverable": req.Discoverable, "map_visible": req.MapVisible, "presence_visible": req.PresenceVisible, "activity_public": req.ActivityPublic, "analytics_opt_in": req.AnalyticsOptIn, "allow_direct_connections": req.AllowDirectConnections, "public_chain_consent": req.PublicChainConsent} {
		if p != nil {
			updates[name] = *p
		}
	}
	if req.MapPrecision != nil {
		if *req.MapPrecision != "country" && *req.MapPrecision != "city" {
			c.JSON(400, gin.H{"error": "Choose country or city precision"})
			return
		}
		updates["map_precision"] = *req.MapPrecision
	}
	if req.ContactMode != nil {
		switch *req.ContactMode {
		case "nobody", "contacts", "inquiries", "everyone":
			updates["contact_mode"] = *req.ContactMode
		default:
			c.JSON(400, gin.H{"error": "Invalid contact mode"})
			return
		}
	}
	if req.AllowDirectConnections != nil && *req.AllowDirectConnections && !u.AllowDirectConnections && !req.AcknowledgeIPDisclosure {
		c.JSON(400, gin.H{"error": "Acknowledge that direct connections reveal network addresses to the counterparty"})
		return
	}
	if req.PublicChainConsent != nil && *req.PublicChainConsent && !u.PublicChainConsent && !req.AcknowledgeChainDisclosure {
		c.JSON(400, gin.H{"error": "Acknowledge that public chain records cannot be withdrawn by hiding or deleting your profile"})
		return
	}
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.User{}).Where("id = ?", u.ID).Updates(updates).Error; err != nil {
			return err
		}
		return tx.Exec("DELETE FROM map_node_links").Error
	}); err != nil {
		c.JSON(500, gin.H{"error": "Cannot save privacy settings"})
		return
	}
	invalidateMarketplaceReadModels()
	invalidateExplorerCache("explorer:*")
	if err := db.DB.First(&u, "id = ?", u.ID).Error; err != nil {
		c.JSON(500, gin.H{"error": "Cannot load settings"})
		return
	}
	c.JSON(200, privacyFrom(u))
}

func previewPrivacy(c *gin.Context) {
	u, ok := privacyUser(c)
	if !ok {
		return
	}
	c.JSON(200, gin.H{"guest_profile": u.ToPublicProfile(), "audiences": gin.H{"guest": gin.H{"profile": u.ToPublicProfile(), "note": "Only public profile fields and alias contributions are visible."}, "contact": gin.H{"profile": u.ToPublicProfile(), "note": "Approved contacts may message unless you choose Nobody or block them."}, "buyer": gin.H{"profile": u.ToPublicProfile(), "note": "An active purchased session may disclose its provider endpoint. Public settlement addresses remain linkable."}}, "profile_page_visible": u.ProfilePublic, "map_visible": u.MapVisible, "precision": privacyFrom(u).MapPrecision, "presence_visible": u.PresenceVisible, "activity_public": u.ActivityPublic, "contact_mode": privacyFrom(u).ContactMode, "network_note": "A purchased provider egress can be observed by destinations. Public settlement wallets remain linkable."})
}

func updateListingContact(c *gin.Context) {
	u, ok := privacyUser(c)
	if !ok {
		return
	}
	var req struct {
		Allow *bool `json:"allow_direct_message" binding:"required"`
	}
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(400, gin.H{"error": "Message preference required"})
		return
	}
	q := db.DB.Model(&models.ProxyListing{}).Where("id = ? AND seller_id = ?", c.Param("id"), u.ID).Update("allow_direct_message", *req.Allow)
	if q.Error != nil {
		c.JSON(500, gin.H{"error": "Cannot update preference"})
		return
	}
	if q.RowsAffected != 1 {
		c.JSON(404, gin.H{"error": "Listing not found"})
		return
	}
	invalidateMarketplaceReadModels()
	c.JSON(200, gin.H{"allow_direct_message": *req.Allow})
}
