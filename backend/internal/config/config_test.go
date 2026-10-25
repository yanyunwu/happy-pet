package config

import (
	"strings"
	"testing"
)

func configure(t *testing.T) {
	t.Helper()
	for k, v := range map[string]string{"JWT_SECRET": strings.Repeat("x", 40), "ADMIN_ORIGIN": "https://game.example.test", "COOKIE_SECURE": "true", "ADMIN_USERNAME": "admin", "ADMIN_PASSWORD": "test-password-123", "API_TRUSTED_PROXIES": "", "DATABASE_URL": "", "PGHOST": "db"} {
		t.Setenv(k, v)
	}
}
func TestContainerConfiguration(t *testing.T) {
	configure(t)
	t.Setenv("API_TRUSTED_PROXIES", "172.30.82.2/32, 127.0.0.1, ::1")
	c, e := Load()
	if e != nil {
		t.Fatal(e)
	}
	if len(c.TrustedProxies) != 3 || !c.CookieSecure || c.DatabaseURL != "" {
		t.Fatal("container PG settings or trusted proxies not preserved")
	}
}
func TestConfigurationRejectsInvalidValues(t *testing.T) {
	for _, item := range []struct{ key, value string }{{"API_TRUSTED_PROXIES", "gateway"}, {"API_TRUSTED_PROXIES", "172.30.82.2/99"}, {"ADMIN_ORIGIN", "http://game.example.test"}, {"ADMIN_ORIGIN", "https://game.example.test/admin/"}, {"JWT_SECRET", "short"}, {"ADMIN_PASSWORD", "short"}, {"ADMIN_USERNAME", "a b"}} {
		t.Run(item.key+item.value, func(t *testing.T) {
			configure(t)
			t.Setenv(item.key, item.value)
			if _, e := Load(); e == nil {
				t.Fatal("invalid configuration accepted")
			}
		})
	}
}
func TestExistingDeploymentMayOmitBootstrapPassword(t *testing.T) {
	configure(t)
	t.Setenv("ADMIN_PASSWORD", "")
	if _, e := Load(); e != nil {
		t.Fatal(e)
	}
}
