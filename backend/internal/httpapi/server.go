package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"happy-pet/api/internal/config"
	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/users"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const cookieName = "happy_pet_admin_session"

type Server struct {
	Service *users.Service
	Config  config.Config
	Log     *slog.Logger
}

func New(service *users.Service, cfg config.Config, logger *slog.Logger) *gin.Engine {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{Service: service, Config: cfg, Log: logger}
	router := gin.New()
	router.Use(gin.Recovery())
	if err := router.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		panic("invalid trusted proxy configuration")
	}
	router.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	})
	router.GET("/health", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if service.DB.PingContext(ctx) != nil {
			c.JSON(503, gin.H{"status": "unavailable"})
			return
		}
		c.JSON(200, gin.H{"status": "ok"})
	})
	router.GET("/api/v1/info", func(c *gin.Context) { c.JSON(200, gin.H{"name": "快乐萌宠消", "version": "0.4.0"}) })
	limiter := newLimiter()
	router.POST("/api/v1/auth/wechat", limiter.middleware("wechat"), s.wechatLogin)
	admin := router.Group("/api/v1/admin")
	admin.POST("/auth/login", s.checkOrigin, limiter.middleware("admin"), s.adminLogin)
	admin.Use(s.requireAuth("admin"))
	admin.GET("/auth/me", func(c *gin.Context) {
		view, err := service.View(c.Request.Context(), currentUser(c), true)
		s.result(c, view, err)
	})
	admin.POST("/auth/logout", s.adminLogout)
	admin.GET("/users", s.listUsers)
	admin.GET("/users/stats", s.stats)
	admin.POST("/users", s.createUser)
	admin.GET("/users/:id", s.getUser)
	admin.PATCH("/users/:id", s.updateUser)
	admin.DELETE("/users/:id", s.deleteUser)
	admin.POST("/users/:id/restore", s.restoreUser)
	admin.POST("/users/:id/password", s.resetPassword)
	user := router.Group("/api/v1/user", s.requireAuth("miniapp"))
	user.GET("/me", func(c *gin.Context) {
		view, err := service.View(c.Request.Context(), currentUser(c), false)
		s.result(c, view, err)
	})
	s.registerGame(router, admin, user)
	user.POST("/logout", func(c *gin.Context) {
		if err := service.Logout(c.Request.Context(), currentUser(c).ID); err != nil {
			s.respondError(c, err)
			return
		}
		c.Status(204)
	})
	router.NoRoute(func(c *gin.Context) {
		c.JSON(404, gin.H{"error": gin.H{"code": "NOT_FOUND", "message": "接口不存在"}})
	})
	return router
}
func (s *Server) respondError(c *gin.Context, err error) {
	var appErr *users.Error
	if errors.As(err, &appErr) {
		c.AbortWithStatusJSON(appErr.Status, gin.H{"error": gin.H{"code": appErr.Code, "message": appErr.Message}})
		return
	}
	s.Log.Error("request failed", "path", c.FullPath(), "error", err)
	c.AbortWithStatusJSON(500, gin.H{"error": gin.H{"code": "INTERNAL_ERROR", "message": "服务暂时不可用，请稍后重试"}})
}
func bind(c *gin.Context, destination any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return users.Invalid("请求内容不正确")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return users.Invalid("请求中只能包含一组数据")
	}
	return nil
}
func (s *Server) checkOrigin(c *gin.Context) {
	if err := s.validateOrigin(c); err != nil {
		s.respondError(c, err)
		return
	}
	c.Next()
}
func (s *Server) validateOrigin(c *gin.Context) error {
	if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
		return nil
	}
	origin := strings.TrimRight(c.GetHeader("Origin"), "/")
	if (origin != "" && origin != strings.TrimRight(s.Config.AdminOrigin, "/")) || c.GetHeader("Sec-Fetch-Site") == "cross-site" {
		return &users.Error{Status: 403, Code: "ORIGIN_REJECTED", Message: "请求来源不被允许"}
	}
	return nil
}
func (s *Server) requireAuth(audience string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var token string
		if audience == "admin" {
			if err := s.validateOrigin(c); err != nil {
				s.respondError(c, err)
				return
			}
			token, _ = c.Cookie(cookieName)
		} else {
			token = strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		}
		user, err := s.Service.Authenticate(c.Request.Context(), token, audience)
		if err != nil {
			s.respondError(c, err)
			return
		}
		c.Set("user", user)
		c.Next()
	}
}
func currentUser(c *gin.Context) dbgen.User { return c.MustGet("user").(dbgen.User) }
func (s *Server) setCookie(c *gin.Context, token string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{Name: cookieName, Value: token, Path: "/api/v1", MaxAge: maxAge, HttpOnly: true, Secure: s.Config.CookieSecure, SameSite: http.SameSiteStrictMode})
}
func (s *Server) adminLogin(c *gin.Context) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := bind(c, &input); err != nil {
		s.respondError(c, err)
		return
	}
	if len(input.Username) > 64 || len(input.Password) > 72 {
		s.respondError(c, users.Invalid("账号或密码长度不正确"))
		return
	}
	session, err := s.Service.AdminLogin(c.Request.Context(), input.Username, input.Password)
	if err != nil {
		s.respondError(c, err)
		return
	}
	s.setCookie(c, session.AccessToken, int(users.SessionTTL.Seconds()))
	c.JSON(200, session.User)
}
func (s *Server) adminLogout(c *gin.Context) {
	if err := s.Service.Logout(c.Request.Context(), currentUser(c).ID); err != nil {
		s.respondError(c, err)
		return
	}
	s.setCookie(c, "", -1)
	c.Status(204)
}
func (s *Server) wechatLogin(c *gin.Context) {
	var input struct {
		Code string `json:"code"`
	}
	if err := bind(c, &input); err != nil {
		s.respondError(c, err)
		return
	}
	session, err := s.Service.WechatLogin(c.Request.Context(), input.Code)
	if err != nil {
		s.respondError(c, err)
		return
	}
	c.JSON(200, session)
}
func (s *Server) listUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	result, err := s.Service.List(c.Request.Context(), users.ListInput{Q: c.Query("q"), Status: c.Query("status"), Source: c.Query("source"), Page: page, PageSize: pageSize})
	if err != nil {
		s.respondError(c, err)
		return
	}
	c.JSON(200, result)
}
func (s *Server) stats(c *gin.Context) {
	result, err := s.Service.Stats(c.Request.Context())
	if err != nil {
		s.respondError(c, err)
		return
	}
	c.JSON(200, result)
}
func (s *Server) createUser(c *gin.Context) {
	var input users.CreateInput
	if err := bind(c, &input); err != nil {
		s.respondError(c, err)
		return
	}
	user, err := s.Service.Create(c.Request.Context(), input, "admin")
	if err != nil {
		s.respondError(c, err)
		return
	}
	c.JSON(201, user)
}
func (s *Server) getUser(c *gin.Context) {
	user, err := s.Service.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		s.respondError(c, err)
		return
	}
	c.JSON(200, user)
}
func (s *Server) updateUser(c *gin.Context) {
	var input users.UpdateInput
	if err := bind(c, &input); err != nil {
		s.respondError(c, err)
		return
	}
	user, err := s.Service.Update(c.Request.Context(), c.Param("id"), input)
	if err != nil {
		s.respondError(c, err)
		return
	}
	c.JSON(200, user)
}
func (s *Server) deleteUser(c *gin.Context) {
	if err := s.Service.Delete(c.Request.Context(), c.Param("id")); err != nil {
		s.respondError(c, err)
		return
	}
	c.Status(204)
}
func (s *Server) restoreUser(c *gin.Context) {
	user, err := s.Service.Restore(c.Request.Context(), c.Param("id"))
	if err != nil {
		s.respondError(c, err)
		return
	}
	c.JSON(200, user)
}
func (s *Server) resetPassword(c *gin.Context) {
	var input struct {
		Password string `json:"password"`
	}
	if err := bind(c, &input); err != nil {
		s.respondError(c, err)
		return
	}
	if err := s.Service.ResetPassword(c.Request.Context(), c.Param("id"), input.Password); err != nil {
		s.respondError(c, err)
		return
	}
	c.Status(204)
}

type limitEntry struct {
	Count int
	Until time.Time
}
type limiter struct {
	mu      sync.Mutex
	entries map[string]limitEntry
}

func newLimiter() *limiter { return &limiter{entries: make(map[string]limitEntry)} }
func (l *limiter) middleware(prefix string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := prefix + ":" + c.ClientIP()
		now := time.Now()
		l.mu.Lock()
		for k, v := range l.entries {
			if !v.Until.After(now) {
				delete(l.entries, k)
			}
		}
		entry, exists := l.entries[key]
		blocked := (!exists && len(l.entries) >= 10000) || entry.Count >= 30
		if !blocked {
			if !exists {
				entry.Until = now.Add(5 * time.Minute)
			}
			entry.Count++
			l.entries[key] = entry
		}
		l.mu.Unlock()
		if blocked {
			c.Header("Retry-After", "300")
			c.AbortWithStatusJSON(429, gin.H{"error": gin.H{"code": "TOO_MANY_ATTEMPTS", "message": "操作太频繁，请稍后再试"}})
			return
		}
		c.Next()
	}
}
