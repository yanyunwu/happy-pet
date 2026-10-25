package httpapi

import (
	"github.com/gin-gonic/gin"
	"happy-pet/api/internal/game"
	"happy-pet/api/internal/users"
	"strconv"
)

func (s *Server) result(c *gin.Context, v any, e error) {
	if e != nil {
		s.respondError(c, e)
	} else {
		c.JSON(200, v)
	}
}
func (s *Server) registerGame(router *gin.Engine, admin, user *gin.RouterGroup) {
	service := game.New(s.Service.DB)
	user.GET("/sessions/:id", func(c *gin.Context) {
		v, e := service.Recovery(c.Request.Context(), currentUser(c).ID, c.Param("id"))
		s.result(c, v, e)
	})
	user.GET("/assets", func(c *gin.Context) {
		v, e := service.Assets(c.Request.Context(), currentUser(c).ID)
		s.result(c, v, e)
	})
	user.POST("/signin", func(c *gin.Context) {
		v, e := service.SignIn(c.Request.Context(), currentUser(c).ID)
		s.result(c, v, e)
	})
	user.GET("/levels", func(c *gin.Context) { v, e := service.Levels(c.Request.Context(), true); s.result(c, v, e) })
	user.POST("/sessions", func(c *gin.Context) {
		var in game.StartInput
		if e := bind(c, &in); e != nil {
			s.respondError(c, e)
			return
		}
		v, e := service.Start(c.Request.Context(), currentUser(c).ID, in)
		s.result(c, v, e)
	})
	user.POST("/sessions/:id/events", func(c *gin.Context) {
		var in struct {
			Events []game.Action `json:"events"`
		}
		if e := bind(c, &in); e != nil {
			s.respondError(c, e)
			return
		}
		v, e := service.Events(c.Request.Context(), currentUser(c).ID, c.Param("id"), in.Events)
		s.result(c, v, e)
	})
	user.POST("/sessions/:id/finish", func(c *gin.Context) {
		var in struct {
			Outcome string `json:"outcome"`
		}
		if e := bind(c, &in); e != nil {
			s.respondError(c, e)
			return
		}
		v, e := service.Finish(c.Request.Context(), currentUser(c).ID, c.Param("id"), in.Outcome)
		s.result(c, v, e)
	})
	admin.GET("/users/:id/assets", func(c *gin.Context) {
		if _, e := s.Service.Get(c.Request.Context(), c.Param("id")); e != nil {
			s.respondError(c, e)
			return
		}
		v, e := service.Assets(c.Request.Context(), c.Param("id"))
		s.result(c, v, e)
	})
	admin.GET("/users/:id/ledger", func(c *gin.Context) { v, e := service.Ledger(c.Request.Context(), c.Param("id")); s.result(c, v, e) })
	admin.POST("/users/:id/assets", func(c *gin.Context) {
		var in game.Adjustment
		if e := bind(c, &in); e != nil {
			s.respondError(c, e)
			return
		}
		v, e := service.Adjust(c.Request.Context(), c.Param("id"), currentUser(c).ID, in)
		s.result(c, v, e)
	})
	admin.GET("/levels", func(c *gin.Context) { v, e := service.Levels(c.Request.Context(), false); s.result(c, v, e) })
	save := func(c *gin.Context) {
		var in game.DraftInput
		if e := bind(c, &in); e != nil {
			s.respondError(c, e)
			return
		}
		v, e := service.SaveLevel(c.Request.Context(), c.Param("id"), in)
		s.result(c, v, e)
	}
	admin.POST("/levels", save)
	admin.PUT("/levels/:id", save)
	admin.POST("/levels/:id/publish", func(c *gin.Context) {
		var in struct {
			DraftVersion int32 `json:"draftVersion"`
		}
		if e := bind(c, &in); e != nil {
			s.respondError(c, e)
			return
		}
		v, e := service.Publish(c.Request.Context(), c.Param("id"), currentUser(c).ID, in.DraftVersion)
		s.result(c, v, e)
	})
	admin.POST("/levels/:id/enabled", func(c *gin.Context) {
		var in struct {
			Enabled bool `json:"enabled"`
		}
		if e := bind(c, &in); e != nil {
			s.respondError(c, e)
			return
		}
		e := service.Enabled(c.Request.Context(), c.Param("id"), in.Enabled)
		s.result(c, gin.H{"ok": e == nil}, e)
	})
	admin.POST("/levels/preview", func(c *gin.Context) {
		var in struct {
			Config game.Config `json:"config"`
			Seed   uint32      `json:"seed"`
		}
		if e := bind(c, &in); e != nil {
			s.respondError(c, e)
			return
		}
		board, _, e := game.NewBoard(in.Config, in.Seed)
		if e != nil {
			s.respondError(c, users.Invalid(e.Error()))
			return
		}
		s.result(c, board.Public(), nil)
	})
	admin.GET("/sessions", func(c *gin.Context) {
		p, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		n, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
		v, e := service.Records(c.Request.Context(), c.Query("userId"), c.Query("mode"), c.Query("status"), c.Query("entry"), p, n)
		s.result(c, v, e)
	})
	admin.GET("/sessions/:id/replay", func(c *gin.Context) { v, e := service.Replay(c.Request.Context(), c.Param("id")); s.result(c, v, e) })
}
