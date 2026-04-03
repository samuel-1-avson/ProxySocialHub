package db

import "gorm.io/gorm"

// Social returns the database connection for social/community tables.
// All tables now live in the same local PostgreSQL instance as the main DB.
func Social() *gorm.DB {
	return DB
}

// InitSocial is a no-op kept for call-site compatibility.
// Social tables are migrated alongside all other tables in migrate.go.
func InitSocial(_ string) error {
	return nil
}

// CloseSocial is a no-op — there is no separate social DB connection to close.
func CloseSocial() {}
