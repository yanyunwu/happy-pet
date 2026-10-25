// Package apidocs serves the versioned API contract without database access.
package apidocs

import (
	_ "embed"
	"net/http"

	"github.com/gin-gonic/gin"
)

//go:embed openapi.json
var document []byte

// Handler returns the complete, self-contained OpenAPI document.
func Handler(c *gin.Context) {
	c.Data(http.StatusOK, "application/json; charset=utf-8", document)
}
