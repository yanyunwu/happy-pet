import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Space, Spin, Typography } from 'antd';
import { FileMarkdownOutlined, ReloadOutlined } from '@ant-design/icons';
import swaggerScript from 'swagger-ui-dist/swagger-ui-bundle.js?url';
import swaggerStyles from 'swagger-ui-dist/swagger-ui.css?url';
import { errorMessage, request } from '../api';

type OpenAPI = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
};
const attribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function documentSource(spec: OpenAPI) {
  // Escape script delimiters in API descriptions before embedding the JSON.
  const json = JSON.stringify(spec).replaceAll('<', '\\u003c');
  const parentOrigin = JSON.stringify(window.location.origin);
  // srcdoc has an about: URL; Swagger needs the real document URL to resolve relative servers.
  const documentUrl = JSON.stringify(
    new URL(`${__ADMIN_CONFIG__.apiBaseUrl}/openapi.json`, window.location.href).href,
  );
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>交互式 API 文档</title>
<script>
  function report(type) { parent.postMessage({ type: 'happy-pet-swagger-' + type }, ${parentOrigin}); }
  window.addEventListener('error', function () { report('error'); });
</script>
<link rel="stylesheet" href="${attribute(swaggerStyles)}" onerror="report('error')">
<style>
  html{color-scheme:light}body{margin:0;background:#fff}
  .swagger-ui .wrapper{max-width:none;padding:0 24px}.swagger-ui .info{margin:24px 0}
  .swagger-ui .info .title{font-size:26px}
  .swagger-ui .scheme-container{box-shadow:none;border-block:1px solid #e8ede9;margin:0 0 24px;padding:18px 0}
  .swagger-ui .opblock{box-shadow:none}.swagger-ui input,.swagger-ui textarea,.swagger-ui select{max-width:100%}
  @media(max-width:600px){.swagger-ui .wrapper{padding:0 12px}.swagger-ui .opblock-summary-path{font-size:12px}.swagger-ui .info .title{font-size:22px}}
</style></head><body><div id="swagger-ui"></div>
<script src="${attribute(swaggerScript)}" onerror="report('error')"></script>
<script>
  if (typeof SwaggerUIBundle === 'function') {
    const ui = SwaggerUIBundle({dom_id:'#swagger-ui',spec:${json},deepLinking:false,docExpansion:'list',filter:true,
      persistAuthorization:false,queryConfigEnabled:false,validatorUrl:null,withCredentials:true,
      displayRequestDuration:true,defaultModelsExpandDepth:0,onComplete:function(){report('ready');}});
    ui.specActions.updateUrl(${documentUrl});
  } else { report('error'); }
</script></body></html>`;
}

export default function ApiDocs() {
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin)
        return;
      if (event.data?.type === 'happy-pet-swagger-ready') setLoading(false);
      if (event.data?.type === 'happy-pet-swagger-error') {
        setError('本地文档资源加载失败，请刷新重试');
        setLoading(false);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    request<OpenAPI>('/openapi.json', { signal: controller.signal })
      .then((spec) => {
        if (controller.signal.aborted) return;
        if (!spec.openapi?.startsWith('3.') || !spec.paths || !spec.info)
          throw new Error('服务返回了无效的 OpenAPI 文档');
        setSource(documentSource(spec));
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(reason));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [revision]);
  const reload = () => {
    setSource('');
    setError('');
    setLoading(true);
    setRevision((value) => value + 1);
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>接口文档</Typography.Title>
          <Typography.Text type="secondary">
            浏览全部接口、参数与响应示例，使用 Bearer Token 在线调试。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined spin={loading} />} onClick={reload} disabled={loading}>
            刷新文档
          </Button>
          <Button
            icon={<FileMarkdownOutlined aria-hidden />}
            href="/admin/SKILL.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            查看 SKILL.md
          </Button>
        </Space>
      </div>
      <Alert
        className="api-docs-notice"
        type="info"
        showIcon
        title="使用个人设置中的 API Token 授权"
        description="点击 Authorize 输入 Token。访问玩家接口时，请同时填写目标玩家的 X-User-ID。授权仅保留在当前文档页面，离开后清空。"
      />
      <Card className="api-docs-card" styles={{ body: { padding: 0 } }}>
        {error ? (
          <div className="api-docs-error">
            <Alert
              type="error"
              showIcon
              title="接口文档加载失败"
              description={error}
              action={<Button onClick={reload}>重试</Button>}
            />
          </div>
        ) : (
          <>
            {loading && (
              <div className="api-docs-loading">
                <Spin />
                <Typography.Text type="secondary">正在加载接口文档…</Typography.Text>
              </div>
            )}
            {source && (
              <iframe
                ref={frame}
                title="交互式 API 文档"
                className="api-docs-frame"
                srcDoc={source}
                onError={() => {
                  setError('本地文档资源加载失败，请刷新重试');
                  setLoading(false);
                }}
              />
            )}
          </>
        )}
      </Card>
    </>
  );
}
