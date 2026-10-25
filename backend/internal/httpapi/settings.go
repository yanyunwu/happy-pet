package httpapi

import (
	"github.com/gin-gonic/gin"
	"happy-pet/api/internal/settings"
	"happy-pet/api/internal/users"
)

func (s *Server) registerSettings(router *gin.Engine, admin *gin.RouterGroup) {
	service := settings.New(s.Service.DB)
	admin.GET("/settings", func(c *gin.Context) {
		value, err := service.Get(c.Request.Context())
		s.result(c, value, err)
	})
	admin.PUT("/settings", func(c *gin.Context) {
		var input struct {
			Announcement *string `json:"announcement"`
			Version      *int32  `json:"version"`
		}
		if err := bind(c, &input); err != nil {
			s.respondError(c, err)
			return
		}
		if input.Announcement == nil || input.Version == nil {
			s.respondError(c, users.Invalid("请提供公告正文和设置版本"))
			return
		}
		value, err := service.Save(c.Request.Context(), *input.Announcement, *input.Version)
		s.result(c, value, err)
	})
	router.GET("/api/v1/settings/announcement", func(c *gin.Context) {
		value, err := service.Get(c.Request.Context())
		if err != nil {
			s.respondError(c, err)
			return
		}
		c.JSON(200, gin.H{"content": value.Announcement, "updatedAt": value.UpdatedAt})
	})
}
