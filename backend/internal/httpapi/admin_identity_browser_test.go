package httpapi

import "testing"

func TestAdminIdentityBrowserIntegration(t *testing.T) {
	runBrowserIntegration(t, "scripts/test-admin-identity-browser.cjs")
}
