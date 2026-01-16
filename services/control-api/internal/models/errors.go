package models

import "errors"

// Social feature errors
var (
	ErrCannotFollowSelf    = errors.New("cannot follow yourself")
	ErrAlreadyFollowing    = errors.New("already following this user")
	ErrNotFollowing        = errors.New("not following this user")
	ErrUserNotFound        = errors.New("user not found")
	ErrUsernameExists      = errors.New("username already taken")
	ErrListingNotFound     = errors.New("listing not found")
	ErrInsufficientBalance = errors.New("insufficient balance")
	ErrOrderNotFound       = errors.New("order not found")
	ErrReviewExists        = errors.New("review already exists for this order")
	ErrConversationExists  = errors.New("conversation already exists")
	ErrUnauthorized        = errors.New("unauthorized action")
)
