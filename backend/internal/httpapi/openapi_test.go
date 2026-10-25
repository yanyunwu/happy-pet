package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"happy-pet/api/internal/config"
	"happy-pet/api/internal/users"
)

// This intentionally constructs the real router without a database: the
// documentation endpoint must remain public and must not query storage.
func TestOpenAPICoversLiveRoutesAndSkill(t *testing.T) {
	router := New(users.New(nil, strings.Repeat("docs-test-", 4), nil), config.Config{}, nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/openapi.json", nil))
	if w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("public OpenAPI response = %d %s: %s", w.Code, w.Header().Get("Content-Type"), w.Body.String())
	}
	var document map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &document); err != nil {
		t.Fatal(err)
	}
	if version, _ := document["openapi"].(string); !strings.HasPrefix(version, "3.") {
		t.Fatalf("expected OpenAPI 3, got %v", document["openapi"])
	}
	paths, ok := document["paths"].(map[string]any)
	if !ok {
		t.Fatal("missing OpenAPI paths")
	}
	skill, err := os.ReadFile("../../../SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	parameter := regexp.MustCompile(`:([A-Za-z][A-Za-z0-9_]*)`)
	registered := map[string]bool{}
	for _, route := range router.Routes() {
		path := parameter.ReplaceAllString(route.Path, "{$1}")
		key := route.Method + " " + path
		registered[key] = true
		pathItem, ok := paths[path].(map[string]any)
		if !ok || pathItem[strings.ToLower(route.Method)] == nil {
			t.Errorf("live route missing from OpenAPI: %s", key)
		}
		if !strings.Contains(string(skill), "`"+key+"`") {
			t.Errorf("live route missing from self-contained SKILL.md: %s", key)
		}
	}
	ids := map[string]bool{}
	for path, value := range paths {
		for method, raw := range value.(map[string]any) {
			if !strings.Contains(" get post put patch delete head options ", " "+method+" ") {
				continue
			}
			key := strings.ToUpper(method) + " " + path
			if !registered[key] {
				t.Errorf("documented operation has no live route: %s", key)
			}
			op := raw.(map[string]any)
			id, _ := op["operationId"].(string)
			if id == "" || ids[id] {
				t.Errorf("missing or duplicate operationId for %s: %q", key, id)
			}
			ids[id] = true
			if op["summary"] == nil || op["responses"] == nil || op["security"] == nil {
				t.Errorf("operation needs summary, responses and explicit security: %s", key)
			}
		}
	}
	checkOpenAPIRefs(t, document, document)
}

func checkOpenAPIRefs(t *testing.T, root map[string]any, value any) {
	t.Helper()
	switch node := value.(type) {
	case map[string]any:
		if ref, ok := node["$ref"].(string); ok {
			if !strings.HasPrefix(ref, "#/") {
				t.Errorf("OpenAPI must be self-contained; external reference %q", ref)
				return
			}
			var target any = root
			for _, segment := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
				segment = strings.ReplaceAll(strings.ReplaceAll(segment, "~1", "/"), "~0", "~")
				object, ok := target.(map[string]any)
				if !ok || object[segment] == nil {
					t.Errorf("unresolved OpenAPI reference %q", ref)
					break
				}
				target = object[segment]
			}
		}
		for _, child := range node {
			checkOpenAPIRefs(t, root, child)
		}
	case []any:
		for _, child := range node {
			checkOpenAPIRefs(t, root, child)
		}
	}
}
