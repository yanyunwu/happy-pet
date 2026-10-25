package users

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"
)

type WechatIdentity struct{ OpenID, UnionID string }
type WechatExchange interface {
	Exchange(context.Context, string) (WechatIdentity, error)
}
type WechatClient struct {
	AppID, Secret string
	HTTP          *http.Client
}

func (w *WechatClient) Exchange(ctx context.Context, code string) (WechatIdentity, error) {
	if w.Secret == "" {
		return WechatIdentity{}, fail(503, "WECHAT_UNAVAILABLE", "微信登录暂未配置完成")
	}
	values := url.Values{"appid": {w.AppID}, "secret": {w.Secret}, "js_code": {code}, "grant_type": {"authorization_code"}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.weixin.qq.com/sns/jscode2session?"+values.Encode(), nil)
	if err != nil {
		return WechatIdentity{}, err
	}
	client := w.HTTP
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	response, err := client.Do(request)
	// Never return the upstream error: it may include the AppSecret in the request URL.
	if err != nil {
		return WechatIdentity{}, fail(502, "WECHAT_UNAVAILABLE", "微信连接失败，请稍后再试")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return WechatIdentity{}, fail(502, "WECHAT_UNAVAILABLE", "微信登录服务暂不可用")
	}
	var result struct {
		OpenID    string `json:"openid"`
		UnionID   string `json:"unionid"`
		ErrorCode int    `json:"errcode"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&result) != nil {
		return WechatIdentity{}, fail(502, "WECHAT_INVALID_RESPONSE", "微信登录响应异常")
	}
	if result.ErrorCode != 0 || result.OpenID == "" {
		return WechatIdentity{}, fail(401, "WECHAT_CODE_INVALID", "微信登录凭证已失效，请重试")
	}
	return WechatIdentity{result.OpenID, result.UnionID}, nil
}
