package api

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
)

// cliDistRoot returns the directory where CLI binaries are stored (CLI_DIST_PATH or /app/cli-dist).
func cliDistRoot() string {
	if p := strings.TrimSpace(os.Getenv("CLI_DIST_PATH")); p != "" {
		return p
	}
	return "/app/cli-dist"
}

func normalizeCLIPlatform(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "darwin":
		return "macos"
	default:
		return strings.ToLower(strings.TrimSpace(platform))
	}
}

func normalizeCLIArch(arch string) string {
	switch strings.ToLower(strings.TrimSpace(arch)) {
	case "x64":
		return "amd64"
	default:
		return strings.ToLower(strings.TrimSpace(arch))
	}
}

// RegisterCLIDistributionRoutes registers CLI download routes
func RegisterCLIDistributionRoutes(rg *gin.RouterGroup) {
	// Public endpoints — provider-node self-update + dashboard downloads (no auth)
	rg.GET("/cli/download", getCLIDownload)
	rg.GET("/cli/downloads/latest", getLatestCLI)

	// Protected endpoints - require authentication
	protected := rg.Group("/cli")
	{
		protected.GET("/downloads", listCLIDownloads)
		protected.POST("/downloads", middleware.RequireAdmin(), uploadCLIBinary)
	}
}

// CLIPlatformInfo represents download info for a platform
type CLIPlatformInfo struct {
	Platform    string `json:"platform"`
	Arch        string `json:"arch"`
	Version     string `json:"version"`
	PackageType string `json:"package_type"`
	DownloadURL string `json:"download_url"`
	FileSize    int64  `json:"file_size"`
	Checksum    string `json:"checksum"`
	Filename    string `json:"filename"`
}

// listCLIDownloads returns available CLI downloads
func listCLIDownloads(c *gin.Context) {
	var downloads []models.CLIDownload

	// Get only latest active versions
	if err := db.DB.Where("is_active = ? AND is_latest = ?", true, true).Find(&downloads).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch downloads"})
		return
	}

	// Group by platform
	result := make(map[string]CLIPlatformInfo)
	for _, d := range downloads {
		packageType := normalizeCLIPackageType(d.PackageType)
		key := fmt.Sprintf("%s_%s", d.Platform, d.Arch)
		if packageType != "daemon" {
			key = fmt.Sprintf("%s_%s_%s", d.Platform, d.Arch, packageType)
		}
		result[key] = CLIPlatformInfo{
			Platform:    d.GetPlatformDisplayName(),
			Arch:        d.GetArchDisplayName(),
			Version:     d.Version,
			PackageType: packageType,
			DownloadURL: buildDownloadURL(c, d),
			FileSize:    d.FileSize,
			Checksum:    d.Checksum,
			Filename:    d.Filename,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"downloads":      result,
		"latest_version": getLatestVersion(downloads),
	})
}

// getLatestCLI returns the latest CLI download for the current platform
func getLatestCLI(c *gin.Context) {
	platform := normalizeCLIPlatform(c.Query("platform"))
	arch := normalizeCLIArch(c.Query("arch"))
	packageType := normalizeCLIPackageType(c.Query("package_type"))

	// Auto-detect if not provided
	if platform == "" {
		platform = detectPlatform()
	}
	if arch == "" {
		arch = detectArch()
	}

	var download models.CLIDownload
	if err := db.DB.Where("platform = ? AND arch = ? AND package_type = ? AND is_latest = ? AND is_active = ?",
		platform, arch, packageType, true, true).First(&download).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":    "No CLI available for your platform",
			"platform": platform,
			"arch":     arch,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"version":      download.Version,
		"platform":     download.GetPlatformDisplayName(),
		"arch":         download.GetArchDisplayName(),
		"package_type": normalizeCLIPackageType(download.PackageType),
		"download_url": buildDownloadURL(c, download),
		"file_size":    download.FileSize,
		"checksum":     download.Checksum,
		"filename":     download.Filename,
	})
}

// getCLIDownload serves the CLI binary file
func getCLIDownload(c *gin.Context) {
	platform := normalizeCLIPlatform(c.Query("platform"))
	arch := normalizeCLIArch(c.Query("arch"))
	packageType := normalizeCLIPackageType(c.DefaultQuery("package_type", "daemon"))
	version := c.Query("version")

	// Validate platform to prevent path traversal
	if !isValidPlatform(platform) || !isValidArch(arch) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid platform or architecture"})
		return
	}

	var download models.CLIDownload
	query := db.DB.Where("platform = ? AND arch = ? AND package_type = ? AND is_active = ?", platform, arch, packageType, true)

	if version != "" {
		query = query.Where("version = ?", version)
	} else {
		query = query.Where("is_latest = ?", true)
	}

	if err := query.First(&download).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "CLI not found"})
		return
	}

	// Check if file exists on disk
	filePath := filepath.Join(cliDistRoot(), download.FilePath)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Binary not found on server"})
		return
	}

	// Set appropriate headers
	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Transfer-Encoding", "binary")
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", download.Filename))
	c.Header("X-Checksum-Sha256", download.Checksum)
	c.Header("X-CLI-Version", download.Version)

	// Serve file
	c.File(filePath)
}

// uploadCLIBinary handles admin upload of CLI binaries
func uploadCLIBinary(c *gin.Context) {
	platform := c.PostForm("platform")
	arch := c.PostForm("arch")
	version := c.PostForm("version")
	packageType := normalizeCLIPackageType(c.PostForm("package_type"))

	if !isValidPlatform(platform) || !isValidArch(arch) || version == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid platform, arch, or version"})
		return
	}

	file, err := c.FormFile("binary")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No binary file provided"})
		return
	}

	// Create directory structure
	dirPath := filepath.Join(cliDistRoot(), version)
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create directory"})
		return
	}

	// Generate filename
	prefix := "provider-node"
	if packageType == "wrapper" {
		prefix = "provider-cli"
	} else if packageType == "bundle" {
		prefix = "provider-bundle"
	} else if packageType == "desktop" {
		prefix = "provider-desktop"
	}
	filename := fmt.Sprintf("%s-%s-%s-%s", prefix, version, platform, arch)
	if packageType == "bundle" {
		filename += ".zip"
	} else if platform == "windows" {
		filename += ".exe"
	}
	filePath := filepath.Join(dirPath, filename)

	// Save file
	if err := c.SaveUploadedFile(file, filePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}

	// Calculate checksum
	checksum, err := calculateChecksum(filePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to calculate checksum"})
		return
	}

	// Get file info
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get file info"})
		return
	}

	// If this is marked as latest, unmark previous latest of the same package
	// type only: uploading a desktop installer must not dethrone the CLI.
	if c.PostForm("is_latest") == "true" {
		db.DB.Model(&models.CLIDownload{}).
			Where("platform = ? AND arch = ? AND package_type = ?", platform, arch, packageType).
			Update("is_latest", false)
	}

	// Create database record
	download := models.CLIDownload{
		Version:     version,
		Platform:    platform,
		Arch:        arch,
		PackageType: packageType,
		Filename:    filename,
		FilePath:    filepath.Join(version, filename),
		FileSize:    fileInfo.Size(),
		Checksum:    checksum,
		IsLatest:    c.PostForm("is_latest") == "true",
		IsActive:    true,
	}

	if err := db.DB.Create(&download).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save download record"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":  "CLI binary uploaded successfully",
		"download": download,
	})
}

// Helper functions

func isValidPlatform(platform string) bool {
	switch platform {
	case "windows", "macos", "darwin", "linux":
		return true
	}
	return false
}

func isValidArch(arch string) bool {
	switch arch {
	case "amd64", "x64", "arm64":
		return true
	}
	return false
}

func detectPlatform() string {
	switch runtime.GOOS {
	case "windows":
		return "windows"
	case "darwin":
		return "macos"
	case "linux":
		return "linux"
	default:
		return "linux"
	}
}

func detectArch() string {
	switch runtime.GOARCH {
	case "amd64":
		return "amd64"
	case "arm64":
		return "arm64"
	default:
		return "amd64"
	}
}

func normalizeCLIPackageType(packageType string) string {
	switch strings.ToLower(strings.TrimSpace(packageType)) {
	case "bundle", "wrapper", "desktop":
		return strings.ToLower(strings.TrimSpace(packageType))
	default:
		return "daemon"
	}
}

func buildDownloadURL(c *gin.Context, download models.CLIDownload) string {
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}

	apiBase := strings.TrimRight(strings.TrimSpace(os.Getenv("API_BASE_URL")), "/")
	// Ignore placeholder/example hosts so listed download links stay usable in production.
	if apiBase == "" || strings.Contains(apiBase, "example.com") || strings.Contains(apiBase, "localhost") {
		host := c.Request.Host
		if fwd := strings.TrimSpace(c.GetHeader("X-Forwarded-Host")); fwd != "" {
			host = strings.Split(fwd, ",")[0]
			host = strings.TrimSpace(host)
		}
		if host == "" {
			host = "localhost:18080"
		}
		apiBase = fmt.Sprintf("%s://%s", scheme, host)
	}

	return fmt.Sprintf("%s/v1/cli/download?platform=%s&arch=%s&version=%s&package_type=%s",
		apiBase, download.Platform, download.Arch, download.Version, normalizeCLIPackageType(download.PackageType))
}

func calculateChecksum(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

func getLatestVersion(downloads []models.CLIDownload) string {
	if len(downloads) == 0 {
		return ""
	}
	best := downloads[0].Version
	for _, d := range downloads {
		if cmpSemver(d.Version, best) > 0 {
			best = d.Version
		}
	}
	return best
}

// cmpSemver returns -1/0/1 for a<b / a==b / a>b (numeric major.minor.patch only).
func cmpSemver(a, b string) int {
	pa := parseSemverParts(a)
	pb := parseSemverParts(b)
	for i := 0; i < 3; i++ {
		if pa[i] < pb[i] {
			return -1
		}
		if pa[i] > pb[i] {
			return 1
		}
	}
	return 0
}

func parseSemverParts(s string) [3]int {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	var out [3]int
	parts := strings.Split(s, ".")
	for i := 0; i < 3 && i < len(parts); i++ {
		n := 0
		for _, c := range parts[i] {
			if c < '0' || c > '9' {
				break
			}
			n = n*10 + int(c-'0')
		}
		out[i] = n
	}
	return out
}
