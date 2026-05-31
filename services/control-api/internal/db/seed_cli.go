package db

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

var cliArtifactPattern = regexp.MustCompile(`^provider-(?:node|cli)-([\d.]+)-([a-z]+)-([a-z0-9]+)(\.exe)?$`)

// SeedCLIDownloads indexes binaries under CLI_DIST_PATH (default /app/cli-dist or repo cli-dist).
func SeedCLIDownloads() {
	if DB == nil {
		return
	}

	root := strings.TrimSpace(os.Getenv("CLI_DIST_PATH"))
	if root == "" {
		for _, candidate := range []string{
			"/app/cli-dist",
			"cli-dist",
			filepath.Join("..", "..", "cli-dist"),
			filepath.Join("..", "cli-dist"),
		} {
			if st, err := os.Stat(candidate); err == nil && st.IsDir() {
				root = candidate
				break
			}
		}
	}
	if root == "" {
		return
	}

	version := strings.TrimSpace(os.Getenv("CLI_DIST_VERSION"))
	if version == "" {
		version = "1.0.0"
	}

	versionDir := filepath.Join(root, version)
	entries, err := os.ReadDir(versionDir)
	if err != nil {
		log.Printf("CLI seed: no dist at %s (%v)", versionDir, err)
		return
	}

	seeded := 0
	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		m := cliArtifactPattern.FindStringSubmatch(ent.Name())
		if m == nil {
			continue
		}
		fileVersion := m[1]
		platform := m[2]
		arch := m[3]
		if platform == "darwin" {
			platform = "macos"
		}

		fullPath := filepath.Join(versionDir, ent.Name())
		checksum, size, err := fileSHA256(fullPath)
		if err != nil {
			log.Printf("CLI seed: skip %s: %v", ent.Name(), err)
			continue
		}

		if err := upsertCLIDownload(fileVersion, platform, arch, ent.Name(), fullPath, size, checksum); err != nil {
			log.Printf("CLI seed: failed %s: %v", ent.Name(), err)
			continue
		}
		seeded++
	}

	if seeded > 0 {
		log.Printf("CLI seed: registered %d artifact(s) from %s", seeded, versionDir)
	}
}

func upsertCLIDownload(version, platform, arch, filename, filePath string, size int64, checksum string) error {
	var existing models.CLIDownload
	err := DB.Where("platform = ? AND arch = ? AND version = ?", platform, arch, version).First(&existing).Error

	record := models.CLIDownload{
		Version:  version,
		Platform: platform,
		Arch:     arch,
		Filename: filename,
		FilePath: filepath.ToSlash(filepath.Join(version, filename)),
		FileSize: size,
		Checksum: checksum,
		IsActive: true,
		IsLatest: true,
	}

	if err == gorm.ErrRecordNotFound {
		record.ID = uuid.New()
		if err := DB.Create(&record).Error; err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		if err := DB.Model(&existing).Updates(map[string]interface{}{
			"filename":    record.Filename,
			"file_path":   record.FilePath,
			"file_size":   record.FileSize,
			"checksum":    record.Checksum,
			"is_active":   true,
			"is_latest":   true,
			"download_url": "",
		}).Error; err != nil {
			return err
		}
	}

	// Mark other versions for this platform/arch as not latest.
	return DB.Model(&models.CLIDownload{}).
		Where("platform = ? AND arch = ? AND version <> ?", platform, arch, version).
		Update("is_latest", false).Error
}

func fileSHA256(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()

	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}
