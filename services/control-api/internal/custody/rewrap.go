package custody

import (
	"bytes"
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type RewrapResult struct {
	Checked    int    `json:"checked"`
	Updated    int    `json:"updated"`
	NextCursor string `json:"next_cursor,omitempty"`
}

// RewrapBatch rotates only DEKs. It never decrypts a signing key. A target
// round-trip is verified before each atomic update. Dry runs exercise recovery
// without writing. A cursor permits bounded, resumable same-key version rotation.
// Run one operator job at a time; callers must keep old keys and backups usable.
func RewrapBatch(ctx context.Context, db *gorm.DB, ring KEK, from string, after uuid.UUID, limit int, apply bool) (RewrapResult, error) {
	var result RewrapResult
	if limit < 1 || limit > 500 {
		return result, fmt.Errorf("custody: rewrap limit must be 1..500")
	}
	old, err := resolveKey(ring, from)
	if err != nil {
		return result, err
	}
	var ids []uuid.UUID
	q := db.WithContext(ctx).Model(&models.EmbeddedWallet{}).Where("kek_id = ?", from)
	if after != uuid.Nil {
		q = q.Where("id > ?", after)
	}
	if err := q.Order("id").Limit(limit).Pluck("id", &ids).Error; err != nil {
		return result, err
	}
	for _, id := range ids {
		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var row models.EmbeddedWallet
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND kek_id = ?", id, from).First(&row).Error; err != nil {
				return err
			}
			dek, err := unwrapContext(ctx, old, row.WrappedDEK)
			if err != nil {
				return err
			}
			defer zero(dek)
			if len(dek) != 32 {
				return fmt.Errorf("%w: invalid recovered data key", ErrKEKUnavailable)
			}
			wrapped, err := wrapContext(ctx, ring, dek)
			if err != nil {
				return err
			}
			check, err := unwrapContext(ctx, ring, wrapped)
			if err != nil {
				return err
			}
			defer zero(check)
			if !bytes.Equal(dek, check) {
				return fmt.Errorf("%w: rewrap recovery check failed", ErrKEKUnavailable)
			}
			if apply {
				if err := tx.Model(&models.EmbeddedWallet{}).Where("id = ?", id).Updates(map[string]any{"wrapped_dek": wrapped, "kek_id": ring.ID()}).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return result, err
		}
		result.Checked++
		if apply {
			result.Updated++
		}
		result.NextCursor = id.String()
	}
	return result, nil
}
