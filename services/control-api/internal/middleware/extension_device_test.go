package middleware

import "testing"

func TestValidChromeExtensionID(t *testing.T) {
	if !ValidChromeExtensionID("abcdefghijklmnopabcdefghijklmnop") {
		t.Fatal("want valid 32-char a-p id")
	}
	if ValidChromeExtensionID("abcdefghijklmnopqrstuvwxyzabcde") {
		t.Fatal("31 chars must fail")
	}
	if ValidChromeExtensionID("abcdefghijklmnopabcdefghijklmnopqq") {
		t.Fatal("too long must fail")
	}
	if ValidChromeExtensionID("abcdefghijklmnopabcdefghijklmnoq") {
		t.Fatal("letter q+ must fail")
	}
	if !ChromeExtensionOriginAllowed("chrome-extension://abcdefghijklmnopabcdefghijklmnop") {
		t.Fatal("want chrome-extension origin allowed")
	}
	if ChromeExtensionOriginAllowed("https://evil.example") {
		t.Fatal("https must not match chrome-extension helper")
	}
}

func TestExtensionDevicePathAllowed(t *testing.T) {
	if !extensionDevicePathAllowed("GET", "/v1/orders") {
		t.Fatal("GET orders")
	}
	if !extensionDevicePathAllowed("GET", "/v1/orders/11111111-1111-1111-1111-111111111111/credentials") {
		t.Fatal("GET credentials")
	}
	if extensionDevicePathAllowed("POST", "/v1/orders") {
		t.Fatal("POST orders must be blocked")
	}
	if extensionDevicePathAllowed("POST", "/v1/extension/pair/start") {
		t.Fatal("device token must not mint pairing codes")
	}
	if !extensionDevicePathAllowed("GET", "/v1/extension/bootstrap") {
		t.Fatal("GET bootstrap")
	}
}
