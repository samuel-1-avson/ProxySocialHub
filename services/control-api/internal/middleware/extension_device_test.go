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
	if !ExtensionOriginAllowed("chrome-extension://abcdefghijklmnopabcdefghijklmnop") {
		t.Fatal("want chrome-extension origin allowed")
	}
	if ExtensionOriginAllowed("https://evil.example") {
		t.Fatal("https must not match the extension origin helper")
	}
}

func TestValidExtensionIDAcceptsFirefox(t *testing.T) {
	for _, id := range []string{
		"abcdefghijklmnopabcdefghijklmnop",
		"extension@proxyhubb.com",
		"{6b29fc40-ca47-1067-b31d-00dd010662da}",
	} {
		if !ValidExtensionID(id) {
			t.Fatalf("want %q valid", id)
		}
	}
	for _, id := range []string{
		"",
		"no-at-sign",
		"bad space@proxyhubb.com",
		"{not-a-uuid}",
		"x@" + string(make([]byte, 80)),
		"evil@proxyhubb.com/../x",
	} {
		if ValidExtensionID(id) {
			t.Fatalf("want %q rejected", id)
		}
	}
	if !ExtensionOriginAllowed("moz-extension://6b29fc40-ca47-1067-b31d-00dd010662da") {
		t.Fatal("want moz-extension origin allowed")
	}
	if ExtensionOriginAllowed("moz-extension://not-a-uuid") {
		t.Fatal("moz-extension origin must carry a uuid")
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
