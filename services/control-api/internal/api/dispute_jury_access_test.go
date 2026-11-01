package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// Jury detail and voting status expose party identities, evidence, votes and
// payouts: only the buyer, the seller, or an assigned juror may read them.

func TestJuryParticipant(t *testing.T) {
	buyer, seller, juror := uuid.New(), uuid.New(), uuid.New()
	stranger := uuid.New()
	jury := models.DisputeJury{BuyerID: buyer, SellerID: seller, Juror1ID: juror, Juror2ID: uuid.New(), Juror3ID: uuid.New()}
	for _, id := range []uuid.UUID{buyer, seller, juror} {
		if !juryParticipant(&jury, id) {
			t.Fatalf("%s must be a jury participant", id)
		}
	}
	if juryParticipant(&jury, stranger) {
		t.Fatal("stranger must not be a jury participant")
	}
	if juryParticipant(&jury, uuid.Nil) {
		t.Fatal("nil user must not be a jury participant")
	}
}

func TestDisputeJuryAccess(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "dispute_juries")

	buyer := testutil.CreateTestUserID(t, "buyer")
	seller := testutil.CreateTestUserID(t, "provider")
	juror := testutil.CreateTestUserID(t, "buyer")
	stranger := testutil.CreateTestUserID(t, "buyer")
	jury := models.DisputeJury{
		DisputeID:      uuid.New(),
		BuyerID:        buyer,
		SellerID:       seller,
		Juror1ID:       juror,
		Juror2ID:       testutil.CreateTestUserID(t, "buyer"),
		Juror3ID:       testutil.CreateTestUserID(t, "buyer"),
		DisputeReason:  "not delivered",
		DisputedAmount: 3,
	}
	if err := db.DB.Create(&jury).Error; err != nil {
		t.Fatalf("create jury: %v", err)
	}

	cases := []struct {
		name   string
		path   string
		userID *uuid.UUID
		want   int
	}{
		{"detailBuyer", "/jury/" + jury.ID.String(), &buyer, http.StatusOK},
		{"DetailSeller", "/jury/" + jury.ID.String(), &seller, http.StatusOK},
		{"DetailJuror", "/jury/" + jury.ID.String(), &juror, http.StatusOK},
		{"DetailStranger", "/jury/" + jury.ID.String(), &stranger, http.StatusForbidden},
		{"DetailAnon", "/jury/" + jury.ID.String(), nil, http.StatusUnauthorized},
		{"StatusBuyer", "/jury/" + jury.ID.String() + "/status", &buyer, http.StatusOK},
		{"StatusStranger", "/jury/" + jury.ID.String() + "/status", &stranger, http.StatusForbidden},
		{"StatusAnon", "/jury/" + jury.ID.String() + "/status", nil, http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := setupTestRouter()
			if tc.userID != nil {
				id := *tc.userID
				r.Use(func(c *gin.Context) {
					c.Set("user_id", id)
				})
			}
			r.GET("/jury/:id", getDisputeJury)
			r.GET("/jury/:id/status", getJuryStatus)
			req := httptest.NewRequest("GET", tc.path, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("GET %s: got %d, want %d (%s)", tc.path, w.Code, tc.want, w.Body.String())
			}
		})
	}
}
