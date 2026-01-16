package email

import (
	"fmt"
)

// SendOrderConfirmationEmail sends confirmation to buyer
func (s *Service) SendOrderConfirmationEmail(to, orderID string, amount float64, sellerName string) error {
	if !s.IsEnabled() {
		return nil
	}

	subject := "Order Confirmed - ProxySocialHub"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><style>body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:30px}.header{text-align:center;margin-bottom:30px}.header h1{color:#f97316}.order-box{background:#f0f9ff;border-radius:8px;padding:20px;margin:20px 0}.btn{display:inline-block;background:#f97316;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px}</style></head>
<body>
<div class="container">
<div class="header"><h1>🛒 Order Confirmed!</h1></div>
<p>Your order has been confirmed and is now being processed.</p>
<div class="order-box">
<p><strong>Order ID:</strong> %s</p>
<p><strong>Amount:</strong> GHS %.2f</p>
<p><strong>Seller:</strong> %s</p>
<p><strong>Status:</strong> Active (funds in escrow)</p>
</div>
<p>Your proxy session is now active. You'll receive credentials shortly.</p>
<p style="text-align:center;margin-top:30px"><a href="%s/orders/%s" class="btn">View Order</a></p>
<p style="color:#666;font-size:12px;margin-top:30px">If you have any issues, please open a dispute within 7 days.</p>
</div>
</body>
</html>`, orderID, amount, sellerName, s.config.AppURL, orderID)

	return s.sendHTML(to, subject, body)
}

// SendNewSaleEmail notifies seller of new sale
func (s *Service) SendNewSaleEmail(to, orderID string, amount float64, buyerName string, bandwidthGB float64) error {
	if !s.IsEnabled() {
		return nil
	}

	subject := "New Sale! - ProxySocialHub"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><style>body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:30px}.header{text-align:center;margin-bottom:30px}.header h1{color:#22c55e}.sale-box{background:#f0fdf4;border-radius:8px;padding:20px;margin:20px 0}.amount{font-size:32px;color:#22c55e;font-weight:bold}.btn{display:inline-block;background:#f97316;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px}</style></head>
<body>
<div class="container">
<div class="header"><h1>💰 You Made a Sale!</h1></div>
<p>Congratulations! Someone purchased bandwidth from your listing.</p>
<div class="sale-box">
<p class="amount">+GHS %.2f</p>
<p><strong>Order ID:</strong> %s</p>
<p><strong>Buyer:</strong> %s</p>
<p><strong>Bandwidth:</strong> %.2f GB</p>
<p><strong>Status:</strong> Funds in escrow (released in 7 days)</p>
</div>
<p style="text-align:center;margin-top:30px"><a href="%s/dashboard/provider" class="btn">View Dashboard</a></p>
</div>
</body>
</html>`, amount, orderID, buyerName, bandwidthGB, s.config.AppURL)

	return s.sendHTML(to, subject, body)
}

// SendNewFollowerEmail notifies user of new follower
func (s *Service) SendNewFollowerEmail(to, followerName, followerUsername string) error {
	if !s.IsEnabled() {
		return nil
	}

	subject := "New Follower - ProxySocialHub"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><style>body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:30px}.header{text-align:center;margin-bottom:30px}.header h1{color:#f97316}.btn{display:inline-block;background:#f97316;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px}</style></head>
<body>
<div class="container">
<div class="header"><h1>👤 New Follower!</h1></div>
<p><strong>%s</strong> (@%s) is now following you.</p>
<p style="text-align:center;margin-top:30px"><a href="%s/profile/%s" class="btn">View Profile</a></p>
</div>
</body>
</html>`, followerName, followerUsername, s.config.AppURL, followerUsername)

	return s.sendHTML(to, subject, body)
}

// SendNewReviewEmail notifies seller of new review
func (s *Service) SendNewReviewEmail(to string, rating int, reviewerName, reviewContent string) error {
	if !s.IsEnabled() {
		return nil
	}

	stars := ""
	for i := 0; i < rating; i++ {
		stars += "⭐"
	}

	subject := fmt.Sprintf("%d-Star Review - ProxySocialHub", rating)
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><style>body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:30px}.header{text-align:center;margin-bottom:30px}.header h1{color:#f97316}.review-box{background:#fef3c7;border-radius:8px;padding:20px;margin:20px 0}.stars{font-size:24px}.btn{display:inline-block;background:#f97316;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px}</style></head>
<body>
<div class="container">
<div class="header"><h1>%s New Review!</h1></div>
<p><strong>%s</strong> left you a review.</p>
<div class="review-box">
<p class="stars">%s</p>
<p>"%s"</p>
</div>
<p style="text-align:center;margin-top:30px"><a href="%s/profile/me" class="btn">View Reviews</a></p>
</div>
</body>
</html>`, stars, reviewerName, stars, reviewContent, s.config.AppURL)

	return s.sendHTML(to, subject, body)
}

// SendEscrowReleasedEmail notifies seller that funds were released
func (s *Service) SendEscrowReleasedEmail(to string, amount float64, orderID string) error {
	if !s.IsEnabled() {
		return nil
	}

	subject := "Payment Released! - ProxySocialHub"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><style>body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:30px}.header{text-align:center;margin-bottom:30px}.header h1{color:#22c55e}.amount{font-size:40px;color:#22c55e;font-weight:bold;text-align:center;margin:30px 0}.btn{display:inline-block;background:#f97316;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px}</style></head>
<body>
<div class="container">
<div class="header"><h1>🎉 Payment Released!</h1></div>
<p class="amount">+GHS %.2f</p>
<p>The buyer has confirmed the order and your payment has been released to your wallet.</p>
<p><strong>Order ID:</strong> %s</p>
<p style="text-align:center;margin-top:30px"><a href="%s/dashboard/wallet" class="btn">View Wallet</a></p>
</div>
</body>
</html>`, amount, orderID, s.config.AppURL)

	return s.sendHTML(to, subject, body)
}
