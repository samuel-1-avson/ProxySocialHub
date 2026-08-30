package api

import "testing"

func TestValidAvatarURL(t *testing.T) {
	if !validAvatarURL("https://cdn.example.com/a.png") {
		t.Fatal("https avatar should be valid")
	}
	if validAvatarURL("javascript:alert(1)") {
		t.Fatal("javascript avatar must be rejected")
	}
	if validAvatarURL("data:text/html;base64,aaaa") {
		t.Fatal("non-image data URI must be rejected")
	}
	okData := "data:image/jpeg;base64," + string(make([]byte, 16))
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
