package httpapi

import (
	"encoding/json"
	"strconv"

	"github.com/gin-gonic/gin"
	"happy-pet/api/internal/admins"
	"happy-pet/api/internal/users"
)

func (s *Server) registerAdminAccounts(admin *gin.RouterGroup) {
	admin.POST("/auth/password", func(c *gin.Context) {
		var input struct {
			CurrentPassword string `json:"currentPassword"`
			Password        string `json:"password"`
		}
		if err := bind(c, &input); err != nil {
			s.respondError(c, err)
			return
		}
		if err := s.Admins.ChangePassword(c.Request.Context(), currentAdmin(c).ID, input.CurrentPassword, input.Password); err != nil {
			s.respondError(c, err)
			return
		}
		s.setCookie(c, "", -1)
		c.Status(204)
	})
	admin.GET("/auth/access-token", func(c *gin.Context) { c.JSON(200, admins.AccessTokenStatus(currentAdmin(c))) })
	admin.PUT("/auth/access-token", func(c *gin.Context) {
		var input *struct {
			AccessToken json.RawMessage `json:"accessToken"`
		}
		if err := bind(c, &input); err != nil {
			s.respondError(c, err)
			return
		}
		if input == nil {
			s.respondError(c, users.Invalid("请求内容需为对象"))
			return
		}
		value := ""
		if input.AccessToken != nil {
			var supplied *string
			if err := json.Unmarshal(input.AccessToken, &supplied); err != nil || supplied == nil {
				s.respondError(c, users.Invalid("访问令牌需为字符串"))
				return
			}
			value = *supplied
		}
		v, err := s.Admins.SetAccessToken(c.Request.Context(), currentAdmin(c), value)
		s.result(c, v, err)
	})
	admin.DELETE("/auth/access-token", func(c *gin.Context) {
		if err := s.Admins.RevokeAccessToken(c.Request.Context(), currentAdmin(c)); err != nil {
			s.respondError(c, err)
			return
		}
		c.Status(204)
	})
	admin.GET("/accounts", func(c *gin.Context) {
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
		v, err := s.Admins.List(c.Request.Context(), admins.ListInput{Q: c.Query("q"), Status: c.Query("status"), Page: page, PageSize: pageSize})
		s.result(c, v, err)
	})
	admin.POST("/accounts", func(c *gin.Context) {
		var input admins.CreateInput
		if err := bind(c, &input); err != nil {
			s.respondError(c, err)
			return
		}
		v, err := s.Admins.Create(c.Request.Context(), input)
		if err != nil {
			s.respondError(c, err)
			return
		}
		c.JSON(201, v)
	})
	admin.GET("/accounts/:id", func(c *gin.Context) { v, err := s.Admins.Get(c.Request.Context(), c.Param("id")); s.result(c, v, err) })
	admin.PATCH("/accounts/:id", func(c *gin.Context) {
		var input admins.UpdateInput
		if err := bind(c, &input); err != nil {
			s.respondError(c, err)
			return
		}
		v, err := s.Admins.Update(c.Request.Context(), c.Param("id"), input)
		s.result(c, v, err)
	})
	admin.DELETE("/accounts/:id", func(c *gin.Context) {
		if err := s.Admins.Delete(c.Request.Context(), c.Param("id")); err != nil {
			s.respondError(c, err)
			return
		}
		c.Status(204)
	})
	admin.POST("/accounts/:id/restore", func(c *gin.Context) {
		v, err := s.Admins.Restore(c.Request.Context(), c.Param("id"))
		s.result(c, v, err)
	})
	admin.POST("/accounts/:id/password", func(c *gin.Context) {
		var input struct {
			Password string `json:"password"`
		}
		if err := bind(c, &input); err != nil {
			s.respondError(c, err)
			return
		}
		if err := s.Admins.ResetPassword(c.Request.Context(), c.Param("id"), input.Password); err != nil {
			s.respondError(c, err)
			return
		}
		c.Status(204)
	})
}
