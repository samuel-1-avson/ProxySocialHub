package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestIncludeCatalogProductQueryParsing(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		query string
		want  bool
	}{
		{"", false},
		{"include=product", true},
		{"include=catalog", true},
		{"include=catalog_product", true},
		{"include=product,seller", true},
		{"include=SELLER,PRODUCT", true},
		{"include=seller", false},
		{"include_catalog=true", false}, // map-only helper; listings use include=
	}

	for _, tc := range cases {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/listings?"+tc.query, nil)
		got := includeCatalogProduct(c)
		if got != tc.want {
			t.Fatalf("query %q: got %v want %v", tc.query, got, tc.want)
		}
	}
}

func TestIncludeCatalogMapQueryParsing(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		query string
		want  bool
	}{
		{"", false},
		{"include=product", true},
		{"include_catalog=true", true},
		{"include_catalog=1", true},
		{"include_catalog=yes", true},
		{"include_catalog=false", false},
	}

	for _, tc := range cases {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/marketplace/map?"+tc.query, nil)
		got := includeCatalogMap(c)
		if got != tc.want {
			t.Fatalf("query %q: got %v want %v", tc.query, got, tc.want)
		}
	}
}
