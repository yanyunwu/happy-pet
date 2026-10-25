package config

import (
	"errors"
	"github.com/joho/godotenv"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strings"
)

type Config struct {
	Addr, DatabaseURL, JWTSecret, AdminOrigin string
	WechatAppID, WechatAppSecret              string
	AdminUsername, AdminPassword              string
	CookieSecure                              bool
	TrustedProxies                            []string
}

func Load() (Config, error) {
	if err := godotenv.Load(".env.local"); err != nil && !os.IsNotExist(err) {
		return Config{}, errors.New("无法读取本地配置")
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" && os.Getenv("PGHOST") == "" {
		databaseURL = "postgres://happy_pet:happy-pet-local-only@127.0.0.1:5432/happy_pet?sslmode=disable"
	}
	c := Config{Addr: value("API_ADDR", "127.0.0.1:8080"), DatabaseURL: databaseURL, JWTSecret: os.Getenv("JWT_SECRET"), AdminOrigin: value("ADMIN_ORIGIN", "http://127.0.0.1:5173"), WechatAppID: value("WECHAT_APP_ID", "wx5f84ab7af535815d"), WechatAppSecret: os.Getenv("WECHAT_APP_SECRET"), AdminUsername: os.Getenv("ADMIN_USERNAME"), AdminPassword: os.Getenv("ADMIN_PASSWORD"), CookieSecure: os.Getenv("COOKIE_SECURE") == "true"}
	for _, raw := range strings.Split(os.Getenv("API_TRUSTED_PROXIES"), ",") {
		proxy := strings.TrimSpace(raw)
		if proxy == "" {
			continue
		}
		if _, e := netip.ParsePrefix(proxy); e != nil {
			if _, e = netip.ParseAddr(proxy); e != nil {
				return c, errors.New("API_TRUSTED_PROXIES 必须填写 IP 地址或 CIDR")
			}
		}
		c.TrustedProxies = append(c.TrustedProxies, proxy)
	}
	if len(c.JWTSecret) < 32 {
		return c, errors.New("JWT_SECRET 至少 32 字节，请运行 make env-init")
	}
	u, e := url.Parse(c.AdminOrigin)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return c, errors.New("ADMIN_ORIGIN 必须是合法来源地址")
	}
	if c.CookieSecure && u.Scheme != "https" {
		return c, errors.New("启用 Secure Cookie 时 ADMIN_ORIGIN 必须使用 HTTPS")
	}
	if c.AdminPassword != "" && (len(c.AdminPassword) < 10 || len(c.AdminPassword) > 72) {
		return c, errors.New("ADMIN_PASSWORD 长度需为 10–72 字节")
	}
	if c.AdminUsername != "" && !regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,32}$`).MatchString(c.AdminUsername) {
		return c, errors.New("ADMIN_USERNAME 需为 3–32 位字母、数字、下划线、点或横线")
	}
	return c, nil
}
func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
