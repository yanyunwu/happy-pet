import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Typography } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { ApiError, errorMessage } from '../api';
import { settingsApi, type Settings as SettingsValue } from '../settings-api';

const announcementLimit = 2000;

export default function Settings() {
  const [settings, setSettings] = useState<SettingsValue | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    settingsApi
      .get(controller.signal)
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setDraft(value.announcement);
        setLoadError('');
        setSaveError('');
        setConflict(false);
        setSaved(false);
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [loadAttempt]);

  const count = [...draft].length;
  const validationError =
    count > announcementLimit
      ? '公告不能超过 2000 个字符'
      : /\p{Cc}/u.test(draft.replace(/[\n\t]/g, ''))
        ? '公告不能包含控制字符'
        : '';
  const changed = settings !== null && draft !== settings.announcement;
  const canSave = changed && !loading && !saving && !loadError && !conflict && !validationError;

  const reload = () => {
    if (loading || savingRef.current) return;
    setLoading(true);
    setLoadError('');
    setSaveError('');
    setSaved(false);
    setLoadAttempt((attempt) => attempt + 1);
  };

  const save = async () => {
    if (!settings || !canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const value = await settingsApi.save({ announcement: draft, version: settings.version });
      if (!mounted.current) return;
      setSettings(value);
      setDraft(value.announcement);
      setSaved(true);
    } catch (error) {
      if (!mounted.current) return;
      setSaveError(errorMessage(error));
      setConflict(error instanceof ApiError && error.status === 409);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>设置</Typography.Title>
          <Typography.Text type="secondary">管理小游戏中的公告内容。</Typography.Text>
        </div>
      </div>
      <Card
        className="settings-card"
        title={<Typography.Title level={4}>更新公告</Typography.Title>}
      >
        <Typography.Paragraph type="secondary" className="settings-intro">
          保存后，玩家下次打开更新公告时会看到最新内容。留空则显示“暂无公告”。
        </Typography.Paragraph>
        {loadError ? (
          <Alert
            className="settings-error"
            type="error"
            showIcon
            title="公告加载失败"
            description={loadError}
            action={<Button onClick={reload}>重试加载</Button>}
          />
        ) : null}
        {saveError ? (
          <Alert
            className="settings-error"
            type={conflict ? 'warning' : 'error'}
            showIcon
            title="设置未保存"
            description={
              <>
                <div>{saveError}</div>
                {conflict ? <div>你的编辑内容已保留。重新加载将替换当前未保存的内容。</div> : null}
              </>
            }
            action={
              conflict ? (
                <Button
                  aria-label="重新加载公告"
                  icon={<ReloadOutlined aria-hidden />}
                  onClick={reload}
                >
                  重新加载公告
                </Button>
              ) : undefined
            }
          />
        ) : null}
        <form
          className="settings-form"
          aria-label="公告设置"
          aria-busy={loading || saving}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="settings-label" htmlFor="announcement-content">
            公告正文
          </label>
          <Input.TextArea
            id="announcement-content"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value.replace(/\r\n?/g, '\n'));
              setSaved(false);
              if (!conflict) setSaveError('');
            }}
            autoSize={{ minRows: 12, maxRows: 20 }}
            disabled={loading || saving || !settings || !!loadError}
            placeholder="输入要向玩家展示的公告，支持换行。"
            status={validationError ? 'error' : undefined}
            aria-invalid={!!validationError}
            aria-describedby={`announcement-hint announcement-count${validationError ? ' announcement-error' : ''}`}
          />
          <div className="settings-field-meta">
            <Typography.Text type="secondary" id="announcement-hint">
              仅支持纯文字，保留换行，最多 2000 个字符。
            </Typography.Text>
            <Typography.Text
              id="announcement-count"
              type={count > announcementLimit ? 'danger' : 'secondary'}
            >
              {count} / {announcementLimit}
            </Typography.Text>
          </div>
          {validationError ? (
            <Typography.Paragraph type="danger" id="announcement-error" role="alert">
              {validationError}
            </Typography.Paragraph>
          ) : null}
          <div className="settings-actions">
            <Button
              type="primary"
              htmlType="submit"
              aria-label="保存设置"
              icon={<SaveOutlined aria-hidden />}
              loading={saving}
              disabled={!canSave}
            >
              保存设置
            </Button>
            <Typography.Text type={saved ? 'success' : 'secondary'} role="status">
              {loading
                ? '正在加载公告…'
                : saving
                  ? '正在保存…'
                  : saved
                    ? '设置已保存'
                    : changed
                      ? '有未保存的修改'
                      : settings
                        ? '已与服务器同步'
                        : '等待加载设置'}
            </Typography.Text>
          </div>
          {settings ? (
            <Typography.Text type="secondary" className="settings-updated">
              上次更新：
              {new Date(settings.updatedAt).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })}
              （北京时间）
            </Typography.Text>
          ) : null}
        </form>
      </Card>
    </>
  );
}
