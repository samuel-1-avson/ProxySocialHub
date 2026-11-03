package models

import "encoding/json"

// Persistence records are safe by default, including nested or future response
// paths. Private self/admin responses must use an explicit authorized DTO.
func (u User) MarshalJSON() ([]byte, error) { return json.Marshal(u.ToPublicProfile()) }

type AccountIdentity struct {
	UserSelfProfile
	Email         string  `json:"email"`
	WalletAddress *string `json:"wallet_address,omitempty"`
}

func (u *User) ToAccountIdentity() AccountIdentity {
	return AccountIdentity{UserSelfProfile: u.ToSelfProfile(), Email: u.Email, WalletAddress: u.WalletAddress}
}
