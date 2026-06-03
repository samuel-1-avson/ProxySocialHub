// P1-A5: SDK Examples API
// Provides code examples and generation for multiple programming languages

package api

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"
	"text/template"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/logging"
)

// SDKLanguage represents supported SDK languages
type SDKLanguage string

const (
	LanguagePython  SDKLanguage = "python"
	LanguageNodeJS  SDKLanguage = "nodejs"
	LanguageGolang  SDKLanguage = "golang"
	LanguageCurl    SDKLanguage = "curl"
	LanguageRuby    SDKLanguage = "ruby"
	LanguagePHP     SDKLanguage = "php"
	LanguageJava    SDKLanguage = "java"
	LanguageDotNet  SDKLanguage = "dotnet"
)

// SDKExample represents a code example
type SDKExample struct {
	Language    string `json:"language"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Code        string `json:"code"`
	Filename    string `json:"filename,omitempty"`
}

// GenerateCodeRequest represents a code generation request
type GenerateCodeRequest struct {
	Language   string `json:"language" binding:"required"`
	SessionID  string `json:"session_id,omitempty"`
	UseCase    string `json:"use_case" binding:"required"` // basic, rotating, sticky, scraping
	ProxyHost  string `json:"proxy_host,omitempty"`
	ProxyPort  int    `json:"proxy_port,omitempty"`
}

// GenerateCodeResponse represents a code generation response
type GenerateCodeResponse struct {
	Language string `json:"language"`
	Code     string `json:"code"`
	Filename string `json:"filename"`
}

// RegisterSDKRoutes registers SDK-related routes
func RegisterSDKRoutes(rg *gin.RouterGroup) {
	sdks := rg.Group("/sdks")
	{
		// Get examples for a language
		sdks.GET("/:language/examples", getSDKExamples)
		
		// Generate custom code
		sdks.POST("/generate-code", generateProxyCode)
		
		// Get all supported languages
		sdks.GET("/languages", getSupportedLanguages)
		
		// Download SDK package
		sdks.GET("/:language/download", downloadSDK)
	}
}

// getSupportedLanguages returns all supported SDK languages
func getSupportedLanguages(c *gin.Context) {
	languages := []gin.H{
		{"id": "python", "name": "Python", "icon": "🐍", "version": "3.8+", "popular": true},
		{"id": "nodejs", "name": "Node.js", "icon": "⬢", "version": "16+", "popular": true},
		{"id": "golang", "name": "Go", "icon": "🐹", "version": "1.20+", "popular": true},
		{"id": "curl", "name": "cURL", "icon": "📡", "version": "any", "popular": false},
		{"id": "ruby", "name": "Ruby", "icon": "💎", "version": "3.0+", "popular": false},
		{"id": "php", "name": "PHP", "icon": "🐘", "version": "8.0+", "popular": false},
		{"id": "java", "name": "Java", "icon": "☕", "version": "11+", "popular": false},
		{"id": "dotnet", "name": ".NET", "icon": "🔷", "version": "6.0+", "popular": false},
	}
	
	c.JSON(http.StatusOK, gin.H{
		"languages": languages,
	})
}

// getSDKExamples returns code examples for a specific language
func getSDKExamples(c *gin.Context) {
	language := SDKLanguage(c.Param("language"))
	sessionID := c.Query("session_id")
	
	// Validate language
	if !isValidLanguage(language) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Unsupported language: %s", language),
			"supported_languages": []string{"python", "nodejs", "golang", "curl", "ruby", "php", "java", "dotnet"},
		})
		return
	}
	
	examples := generateExamples(language, sessionID)
	
	c.JSON(http.StatusOK, gin.H{
		"language": language,
		"examples": examples,
	})
}

// generateProxyCode generates custom proxy code based on user requirements
func generateProxyCode(c *gin.Context) {
	var req GenerateCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Set defaults
	if req.ProxyHost == "" {
		req.ProxyHost = "proxy.proxyhub.io"
	}
	if req.ProxyPort == 0 {
		_, req.ProxyPort, _ = BuyerProxyConnectInfo()
	}
	
	language := SDKLanguage(req.Language)
	if !isValidLanguage(language) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Unsupported language: %s", req.Language),
		})
		return
	}
	
	code, filename, err := generateCode(language, req)
	if err != nil {
		logging.Error(err).Str("language", req.Language).Msg("Failed to generate code")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate code"})
		return
	}
	
	c.JSON(http.StatusOK, GenerateCodeResponse{
		Language: req.Language,
		Code:     code,
		Filename: filename,
	})
}

// downloadSDK provides SDK package download
func downloadSDK(c *gin.Context) {
	language := SDKLanguage(c.Param("language"))
	
	if !isValidLanguage(language) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported language"})
		return
	}
	
	// For now, return installation instructions
	c.JSON(http.StatusOK, gin.H{
		"language": language,
		"installation": getInstallationInstructions(language),
		"package_url": fmt.Sprintf("https://github.com/proxyhubb/sdk-%s", language),
	})
}

// Helper functions

func isValidLanguage(lang SDKLanguage) bool {
	switch lang {
	case LanguagePython, LanguageNodeJS, LanguageGolang, LanguageCurl,
		LanguageRuby, LanguagePHP, LanguageJava, LanguageDotNet:
		return true
	}
	return false
}

func generateExamples(language SDKLanguage, sessionID string) []SDKExample {
	username := sessionID
	if username == "" {
		username = "YOUR_SESSION_ID"
	}
	password := "YOUR_SESSION_PASSWORD"
	proxyHost, proxyPort, _ := BuyerProxyConnectInfo()
	
	examples := []SDKExample{
		{
			Language:    string(language),
			Title:       "Basic HTTP Request",
			Description: "Make a simple HTTP request through ProxyHub",
			Code:        generateBasicExample(language, username, password, proxyHost, proxyPort),
			Filename:    getFilename(language, "basic"),
		},
		{
			Language:    string(language),
			Title:       "Rotating Proxy Session",
			Description: "Use rotating IP addresses for each request",
			Code:        generateRotatingExample(language, username, password, proxyHost, proxyPort),
			Filename:    getFilename(language, "rotating"),
		},
		{
			Language:    string(language),
			Title:       "Sticky Proxy Session",
			Description: "Maintain the same IP address across multiple requests",
			Code:        generateStickyExample(language, username, password, proxyHost, proxyPort),
			Filename:    getFilename(language, "sticky"),
		},
		{
			Language:    string(language),
			Title:       "Web Scraping Setup",
			Description: "Configure for web scraping with retry logic",
			Code:        generateScrapingExample(language, username, password, proxyHost, proxyPort),
			Filename:    getFilename(language, "scraping"),
		},
	}
	
	return examples
}

func generateCode(language SDKLanguage, req GenerateCodeRequest) (string, string, error) {
	username := req.SessionID
	if username == "" {
		username = "YOUR_SESSION_ID"
	}
	password := "YOUR_SESSION_PASSWORD"
	
	switch req.UseCase {
	case "basic":
		return generateBasicExample(language, username, password, req.ProxyHost, req.ProxyPort), getFilename(language, "basic"), nil
	case "rotating":
		return generateRotatingExample(language, username, password, req.ProxyHost, req.ProxyPort), getFilename(language, "rotating"), nil
	case "sticky":
		return generateStickyExample(language, username, password, req.ProxyHost, req.ProxyPort), getFilename(language, "sticky"), nil
	case "scraping":
		return generateScrapingExample(language, username, password, req.ProxyHost, req.ProxyPort), getFilename(language, "scraping"), nil
	default:
		return "", "", fmt.Errorf("unknown use case: %s", req.UseCase)
	}
}

func getFilename(language SDKLanguage, useCase string) string {
	extensions := map[SDKLanguage]string{
		LanguagePython: ".py",
		LanguageNodeJS: ".js",
		LanguageGolang: ".go",
		LanguageCurl:   ".sh",
		LanguageRuby:   ".rb",
		LanguagePHP:    ".php",
		LanguageJava:   ".java",
		LanguageDotNet: ".cs",
	}
	
	ext, ok := extensions[language]
	if !ok {
		ext = ".txt"
	}
	
	return fmt.Sprintf("proxyhub_%s%s", useCase, ext)
}

func generateBasicExample(lang SDKLanguage, username, password, host string, port int) string {
	proxyURL := fmt.Sprintf("http://%s:%s@%s:%d", username, password, host, port)
	
	switch lang {
	case LanguagePython:
		return fmt.Sprintf(`import requests

# ProxyHub Basic Example
proxy = {
    "http": "%s",
    "https": "%s"
}

# Make request through ProxyHub
try:
    response = requests.get("https://httpbin.org/ip", proxies=proxy, timeout=30)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
except requests.exceptions.RequestException as e:
    print(f"Error: {e}")`, proxyURL, proxyURL)

	case LanguageNodeJS:
		return fmt.Sprintf(`const axios = require('axios');

// ProxyHub Basic Example
const proxy = {
    host: '%s',
    port: %d,
    auth: {
        username: '%s',
        password: '%s'
    }
};

// Make request through ProxyHub
axios.get('https://httpbin.org/ip', { proxy, timeout: 30000 })
    .then(response => {
        console.log('Status:', response.status);
        console.log('Response:', response.data);
    })
    .catch(error => {
        console.error('Error:', error.message);
    });`, host, port, username, password)

	case LanguageGolang:
		return fmt.Sprintf(`package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

func main() {
	// ProxyHub Basic Example
	proxyURL, _ := url.Parse("%s")
	
	client := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
		Timeout: 30 * time.Second,
	}
	
	// Make request through ProxyHub
	resp, err := client.Get("https://httpbin.org/ip")
	if err != nil {
		fmt.Printf("Error: %%v\n", err)
		return
	}
	defer resp.Body.Close()
	
	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("Status: %%d\n", resp.StatusCode)
	fmt.Printf("Response: %%s\n", body)
}`, proxyURL)

	case LanguageCurl:
		return fmt.Sprintf(`#!/bin/bash
# ProxyHub Basic Example

curl -x "%s" \\
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \\
  https://httpbin.org/ip

echo ""  # New line`, proxyURL)

	default:
		return fmt.Sprintf("# Example for %s\n# Proxy URL: %s", lang, proxyURL)
	}
}

func generateRotatingExample(lang SDKLanguage, username, password, host string, port int) string {
	proxyURL := fmt.Sprintf("http://%s:%s@%s:%d", username, password, host, port)
	
	switch lang {
	case LanguagePython:
		return fmt.Sprintf(`import requests
import random

# ProxyHub Rotating Session Example
# Each request gets a new IP address

proxy = {
    "http": "%s",
    "https": "%s"
}

# Simulate multiple requests (each gets different IP)
for i in range(5):
    try:
        # Add random delay to avoid rate limiting
        time.sleep(random.uniform(1, 3))
        
        response = requests.get(
            "https://httpbin.org/ip",
            proxies=proxy,
            timeout=30,
            headers={
                "User-Agent": f"Mozilla/5.0 (Request-{i})"
            }
        )
        
        data = response.json()
        print(f"Request {i+1}: IP = {data.get('origin', 'unknown')}")
        
    except Exception as e:
        print(f"Request {i+1} failed: {e}")`, proxyURL, proxyURL)

	case LanguageNodeJS:
		return fmt.Sprintf(`const axios = require('axios');

// ProxyHub Rotating Session Example
// Each request gets a new IP address

const proxy = {
    host: '%s',
    port: %d,
    auth: {
        username: '%s',
        password: '%s'
    }
};

// Make multiple requests (each gets different IP)
async function makeRequests() {
    for (let i = 0; i < 5; i++) {
        try {
            // Add delay between requests
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            
            const response = await axios.get('https://httpbin.org/ip', {
                proxy,
                timeout: 30000,
                headers: {
                    'User-Agent': "Mozilla/5.0 (Request-" + i + ")"
                }
            });
            
            console.log("Request " + (i + 1) + ": IP =", response.data.origin);
        } catch (error) {
            console.error("Request " + (i + 1) + " failed:", error.message);
        }
    }
}

makeRequests();`, host, port, username, password)

	default:
		return generateBasicExample(lang, username, password, host, port)
	}
}

func generateStickyExample(lang SDKLanguage, username, password, host string, port int) string {
	// For sticky sessions, we use the same proxy config but maintain session
	proxyURL := fmt.Sprintf("http://%s:%s@%s:%d", username, password, host, port)
	
	switch lang {
	case LanguagePython:
		return fmt.Sprintf(`import requests

# ProxyHub Sticky Session Example
# Maintains the same IP across multiple requests

# Create a session - this maintains cookies and connection
session = requests.Session()

# Configure proxy (same IP for all requests)
session.proxies = {
    "http": "%s",
    "https": "%s"
}

# All requests use the same IP
print("Making multiple requests with same IP...")

# Request 1 - Login
login_data = {"username": "user", "password": "pass"}
r1 = session.post("https://httpbin.org/post", json=login_data)
print(f"Login status: {r1.status_code}")

# Request 2 - Get data (same IP)
r2 = session.get("https://httpbin.org/ip")
print(f"IP Info: {r2.json()}")

# Request 3 - Update profile (same IP still)
profile_data = {"name": "John Doe"}
r3 = session.put("https://httpbin.org/put", json=profile_data)
print(f"Update status: {r3.status_code}")

print("All requests used the same IP address")`, proxyURL, proxyURL)

	case LanguageNodeJS:
		return fmt.Sprintf(`const axios = require('axios');

// ProxyHub Sticky Session Example
// Maintains the same IP across multiple requests

const proxy = {
    host: '%s',
    port: %d,
    auth: {
        username: '%s',
        password: '%s'
    }
};

// Create axios instance with cookie jar for session
const client = axios.create({
    proxy,
    timeout: 30000,
    withCredentials: true
});

async function stickySession() {
    console.log('Making multiple requests with same IP...');
    
    try {
        // Request 1 - Login
        const r1 = await client.post('https://httpbin.org/post', {
            username: 'user',
            password: 'pass'
        });
        console.log('Login status:', r1.status);
        
        // Request 2 - Get data (same IP)
        const r2 = await client.get('https://httpbin.org/ip');
        console.log('IP Info:', r2.data);
        
        // Request 3 - Update (same IP still)
        const r3 = await client.put('https://httpbin.org/put', {
            name: 'John Doe'
        });
        console.log('Update status:', r3.status);
        
        console.log('All requests used the same IP address');
    } catch (error) {
        console.error('Error:', error.message);
    }
}

stickySession();`, host, port, username, password)

	default:
		return generateBasicExample(lang, username, password, host, port)
	}
}

func generateScrapingExample(lang SDKLanguage, username, password, host string, port int) string {
	proxyURL := fmt.Sprintf("http://%s:%s@%s:%d", username, password, host, port)
	
	switch lang {
	case LanguagePython:
		return fmt.Sprintf(`import requests
import random
import time
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ProxyHub Web Scraping Example
# Production-ready setup with retry logic

class ProxyHubScraper:
    def __init__(self, proxy_url):
        self.proxy = {
            "http": proxy_url,
            "https": proxy_url
        }
        
        # Create session with retry strategy
        self.session = requests.Session()
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        
        # Default headers
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
        })
    
    def scrape(self, url):
        """Scrape a URL with error handling"""
        try:
            # Random delay to be polite
            time.sleep(random.uniform(1, 3))
            
            response = self.session.get(
                url,
                proxies=self.proxy,
                timeout=30,
                allow_redirects=True
            )
            response.raise_for_status()
            
            return {
                "status": response.status_code,
                "url": response.url,
                "content": response.text[:1000]  # First 1000 chars
            }
            
        except requests.exceptions.ProxyError as e:
            print(f"Proxy error: {e}")
            return None
        except requests.exceptions.Timeout:
            print(f"Timeout error")
            return None
        except Exception as e:
            print(f"Error: {e}")
            return None

# Usage
scraper = ProxyHubScraper("%s")

urls = [
    "https://httpbin.org/ip",
    "https://httpbin.org/user-agent",
]

for url in urls:
    result = scraper.scrape(url)
    if result:
        print(f"✓ Scraped: {result['url']}")
    else:
        print(f"✗ Failed: {url}")`, proxyURL)

	default:
		return generateBasicExample(lang, username, password, host, port)
	}
}

func getInstallationInstructions(lang SDKLanguage) string {
	switch lang {
	case LanguagePython:
		return "pip install proxyhub-sdk"
	case LanguageNodeJS:
		return "npm install @proxyhub/sdk"
	case LanguageGolang:
		return "go get github.com/proxyhubb/sdk-go"
	case LanguageRuby:
		return "gem install proxyhub"
	case LanguagePHP:
		return "composer require proxyhub/sdk"
	case LanguageJava:
		return "<dependency>\n  <groupId>io.proxyhub</groupId>\n  <artifactId>sdk</artifactId>\n</dependency>"
	case LanguageDotNet:
		return "dotnet add package ProxyHub.SDK"
	default:
		return "See documentation at https://docs.proxyhub.io"
	}
}

// Template cache for performance
var templateCache = make(map[string]*template.Template)

func getTemplate(name string, content string) *template.Template {
	if tmpl, ok := templateCache[name]; ok {
		return tmpl
	}
	
	tmpl := template.Must(template.New(name).Parse(content))
	templateCache[name] = tmpl
	return tmpl
}

// executeTemplate executes a template with data and returns the result
func executeTemplate(tmpl *template.Template, data interface{}) (string, error) {
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// String helper functions
func toLower(s string) string {
	return strings.ToLower(s)
}

func toUpper(s string) string {
	return strings.ToUpper(s)
}
