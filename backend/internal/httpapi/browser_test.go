package httpapi

import (
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestBrowserIntegration(t *testing.T) {
	if os.Getenv("BROWSER_QA") != "1" {
		t.Skip("run make test-browser for built admin + Cocos integration")
	}
	h := setup(t)
	server := httptest.NewServer(h.router)
	defer server.Close()
	root, e := filepath.Abs("../../..")
	if e != nil {
		t.Fatal(e)
	}
	command := exec.Command("node", "scripts/test-browser.cjs")
	command.Dir = root
	command.Env = append(os.Environ(), "QA_API_ORIGIN="+server.URL)
	output, e := command.CombinedOutput()
	t.Log(string(output))
	if e != nil {
		t.Fatal(e)
	}
}
