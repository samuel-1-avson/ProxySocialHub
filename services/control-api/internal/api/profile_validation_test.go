package api

import (
	"encoding/base64"
	"testing"
)

func TestValidAvatarURL(t *testing.T) {
	t.Setenv("PROFILE_MEDIA_ORIGINS", "https://cdn.example.com")
	if validAvatarURL("https://tracker.example.test/a.png") {
		t.Fatal("unapproved tracker origin accepted")
	}
	if !validAvatarURL("https://cdn.example.com/a.png") {
		t.Fatal("https avatar should be valid")
	}
	if validAvatarURL("javascript:alert(1)") {
		t.Fatal("javascript avatar must be rejected")
	}
	if validAvatarURL("data:text/html;base64,aaaa") {
		t.Fatal("non-image data URI must be rejected")
	}
	okData := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(make([]byte, 16))
	if !validAvatarURL(okData) {
		t.Fatal("small jpeg data URI should be valid")
	}
}

func TestProfileUsernameRe(t *testing.T) {
	if !profileUsernameRe.MatchString("commonbruh") {
		t.Fatal("expected alphanumeric username")
	}
	if !profileUsernameRe.MatchString("user_62vw") {
		t.Fatal("expected underscore username")
	}
	if profileUsernameRe.MatchString("ab") {
		t.Fatal("too short")
	}
	if profileUsernameRe.MatchString("has-dash") {
		t.Fatal("dash should fail")
	}
}
