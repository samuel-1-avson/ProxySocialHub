package email

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/smtp"
	"os"
	"strings"
)

// Config holds email service configuration
type Config struct {
	SMTPHost  string
	SMTPPort  string
	SMTPUser  string
	SMTPPass  string
	FromEmail string
	FromName  string
	AppURL    string
	Enabled   bool
}

// Service handles email sending
type Service struct {
	config Config
}

// Global email service instance
var emailService *Service

// Init initializes the email service with environment variables
func Init() error {
	config := Config{
		SMTPHost:  os.Getenv("SMTP_HOST"),
		SMTPPort:  os.Getenv("SMTP_PORT"),
		SMTPUser:  os.Getenv("SMTP_USER"),
		SMTPPass:  os.Getenv("SMTP_PASS"),
		FromEmail: os.Getenv("FROM_EMAIL"),
		FromName:  getEnvOrDefault("FROM_NAME", "ProxyHubb"),
		AppURL:    getEnvOrDefault("APP_URL", "http://localhost:3000"),
		Enabled:   os.Getenv("SMTP_HOST") != "",
	}

	if config.SMTPPort == "" {
		config.SMTPPort = "587"
	}

	emailService = &Service{config: config}

	if !config.Enabled {
		log.Println("Email service disabled: SMTP_HOST not configured")
	} else {
		log.Printf("Email service enabled: %s:%s", config.SMTPHost, config.SMTPPort)
	}

	return nil
}

// GetService returns the global email service instance
func GetService() *Service {
	return emailService
}

// IsEnabled returns true if email sending is configured
func (s *Service) IsEnabled() bool {
	if s == nil {
		return false
	}
	return s.config.Enabled
}

// SendVerificationEmail sends an email verification link
func (s *Service) SendVerificationEmail(to, token string) error {
	if !s.IsEnabled() {
		log.Printf("[EMAIL-DEV] Verification email for %s: token=%s", to, token)
		log.Printf("[EMAIL-DEV] Verify URL: %s/verify-email?token=%s", s.config.AppURL, token)
		return nil // In dev mode, just log
	}

	verifyURL := fmt.Sprintf("%s/verify-email?token=%s", s.config.AppURL, token)

	subject := "Verify your ProxyHubb email address"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Verify Your Email</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%%, #764ba2 100%%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; text-align: center;">ProxyHubb</h1>
    </div>
    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <h2 style="color: #333;">Verify Your Email Address</h2>
        <p>Thank you for signing up! Please click the button below to verify your email address.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="%s" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email</a>
        </div>
        <p style="color: #666; font-size: 14px;">This link will expire in 24 hours.</p>
        <p style="color: #666; font-size: 14px;">If you didn't create an account, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
        <p style="color: #999; font-size: 12px; text-align: center;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="%s" style="color: #667eea;">%s</a>
        </p>
    </div>
</body>
</html>
`, verifyURL, verifyURL, verifyURL)

	return s.sendHTML(to, subject, body)
}

// SendPasswordResetEmail sends a password reset link
func (s *Service) SendPasswordResetEmail(to, token string) error {
	if !s.IsEnabled() {
		log.Printf("[EMAIL-DEV] Password reset email for %s: token=%s", to, token)
		return nil
	}

	resetURL := fmt.Sprintf("%s/reset-password?token=%s", s.config.AppURL, token)

	subject := "Reset your ProxyHubb password"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Reset Password</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%%, #764ba2 100%%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; text-align: center;">ProxyHubb</h1>
    </div>
    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <h2 style="color: #333;">Reset Your Password</h2>
        <p>You requested to reset your password. Click the button below to create a new password.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="%s" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
        </div>
        <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>
        <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
</body>
</html>
`, resetURL)

	return s.sendHTML(to, subject, body)
}

// Send2FABackupCodesEmail sends the backup codes to user
func (s *Service) Send2FABackupCodesEmail(to string, codes []string) error {
	if !s.IsEnabled() {
		log.Printf("[EMAIL-DEV] 2FA backup codes for %s: %v", to, codes)
		return nil
	}

	codesList := strings.Join(codes, "<br>")

	subject := "Your ProxyHubb 2FA Backup Codes"
	body := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>2FA Backup Codes</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%%, #764ba2 100%%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; text-align: center;">ProxyHubb</h1>
    </div>
    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <h2 style="color: #333;">Your 2FA Backup Codes</h2>
        <p>Here are your backup codes. Store them in a safe place - you can use each code once if you lose access to your authenticator app.</p>
        <div style="background: white; padding: 20px; border-radius: 5px; font-family: monospace; font-size: 16px; text-align: center; margin: 20px 0;">
            %s
        </div>
        <p style="color: #e74c3c; font-weight: bold;">⚠️ Keep these codes secure and private!</p>
    </div>
</body>
</html>
`, codesList)

	return s.sendHTML(to, subject, body)
}

// sendHTML sends an HTML email
func (s *Service) sendHTML(to, subject, htmlBody string) error {
	headers := make(map[string]string)
	headers["From"] = fmt.Sprintf("%s <%s>", s.config.FromName, s.config.FromEmail)
	headers["To"] = to
	headers["Subject"] = subject
	headers["MIME-Version"] = "1.0"
	headers["Content-Type"] = "text/html; charset=UTF-8"

	var message strings.Builder
	for key, value := range headers {
		message.WriteString(fmt.Sprintf("%s: %s\r\n", key, value))
	}
	message.WriteString("\r\n")
	message.WriteString(htmlBody)

	auth := smtp.PlainAuth("", s.config.SMTPUser, s.config.SMTPPass, s.config.SMTPHost)

	// Use TLS if port is 465
	if s.config.SMTPPort == "465" {
		return s.sendWithTLS(to, message.String())
	}

	addr := fmt.Sprintf("%s:%s", s.config.SMTPHost, s.config.SMTPPort)
	return smtp.SendMail(addr, auth, s.config.FromEmail, []string{to}, []byte(message.String()))
}

// sendWithTLS sends email using TLS (for port 465)
func (s *Service) sendWithTLS(to, message string) error {
	tlsConfig := &tls.Config{
		ServerName: s.config.SMTPHost,
	}

	addr := fmt.Sprintf("%s:%s", s.config.SMTPHost, s.config.SMTPPort)
	conn, err := tls.Dial("tcp", addr, tlsConfig)
	if err != nil {
		return fmt.Errorf("failed to dial TLS: %w", err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, s.config.SMTPHost)
	if err != nil {
		return fmt.Errorf("failed to create SMTP client: %w", err)
	}
	defer client.Close()

	auth := smtp.PlainAuth("", s.config.SMTPUser, s.config.SMTPPass, s.config.SMTPHost)
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("SMTP auth failed: %w", err)
	}

	if err := client.Mail(s.config.FromEmail); err != nil {
		return fmt.Errorf("MAIL command failed: %w", err)
	}

	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("RCPT command failed: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA command failed: %w", err)
	}

	_, err = w.Write([]byte(message))
	if err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	err = w.Close()
	if err != nil {
		return fmt.Errorf("failed to close writer: %w", err)
	}

	return client.Quit()
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
