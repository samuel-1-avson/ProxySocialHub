package models

import (
	"time"

	"gorm.io/gorm"
)

// SoftDeleteModel embeds gorm.Model but with a proper DeletedAt field
// Use this as a base for all models that support soft deletes
type SoftDeleteModel struct {
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

// BaseModel is the standard model with ID and soft delete support
type BaseModel struct {
	ID        string         `gorm:"type:uuid;primary_key" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

// SoftDelete performs a soft delete on the record
// Usage: db.Model(&record).Update("deleted_at", gorm.DeletedAt{Time: time.Now(), Valid: true})
func SoftDeleteRecord(db *gorm.DB, model interface{}) error {
	return db.Model(model).Update("deleted_at", gorm.DeletedAt{Time: time.Now(), Valid: true}).Error
}

// RestoreRecord undoes a soft delete
func RestoreRecord(db *gorm.DB, model interface{}) error {
	return db.Model(model).Unscoped().Update("deleted_at", nil).Error
}

// PermanentlyDelete performs a hard delete (bypasses soft delete)
func PermanentlyDelete(db *gorm.DB, model interface{}) error {
	return db.Unscoped().Delete(model).Error
}

// WithTrashed returns a DB instance that includes soft-deleted records
func WithTrashed(db *gorm.DB) *gorm.DB {
	return db.Unscoped()
}

// OnlyTrashed returns a DB instance that only includes soft-deleted records
func OnlyTrashed(db *gorm.DB) *gorm.DB {
	return db.Unscoped().Where("deleted_at IS NOT NULL")
}
