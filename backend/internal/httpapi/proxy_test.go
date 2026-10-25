package httpapi

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
)

func TestTrustedProxyKeepsClientRateLimitsSeparate(t *testing.T) {
	r := gin.New()
	if e := r.SetTrustedProxies([]string{"172.30.82.2/32"}); e != nil {
		t.Fatal(e)
	}
	r.POST("/login", newLimiter().middleware("login"), func(c *gin.Context) { c.Status(204) })
	for _, proxy := range []bool{true, false} {
		for i := 0; i < 31; i++ {
			req := httptest.NewRequest("POST", "/login", nil)
			req.RemoteAddr = "198.51.100.4:1234"
			if proxy {
				req.RemoteAddr = "172.30.82.2:1234"
			}
			req.Header.Set("X-Forwarded-For", fmt.Sprintf("203.0.113.%d", i+1))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			want := 204
			if !proxy && i == 30 {
				want = 429
			}
			if w.Code != want {
				t.Fatalf("trusted=%t request=%d: got %d want %d", proxy, i, w.Code, want)
			}
		}
	}
}
