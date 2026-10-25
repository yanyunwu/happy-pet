import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Badge,
  Button,
  Divider,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  KeyOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { adminApi, type AccessTokenStatus } from '../admin-api';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { formatAccountDate, passwordRule } from '../credentials';

type PasswordForm = { currentPassword: string; password: string; confirmation: string };

// Mounted only while open: passwords and the one-time token never outlive this dialog.
export default function PersonalSettings({ onClose }: { onClose(): void }) {
  const { message, modal } = App.useApp();
  const auth = useAuth();
  const [passwordForm] = Form.useForm<PasswordForm>();
  const [tokenForm] = Form.useForm<{ accessToken: string }>();
  const [status, setStatus] = useState<AccessTokenStatus | null>(null);
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<'password' | 'token' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    adminApi
      .accessToken(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  const changePassword = async ({ currentPassword, password }: PasswordForm) => {
    setBusy('password');
    try {
      await adminApi.changePassword({ currentPassword, password });
      passwordForm.resetFields();
      tokenForm.resetFields();
      setSecret('');
      onClose();
      auth.clearSession();
      void message.success('密码已更新，请使用新密码重新登录');
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const saveToken = async (accessToken?: string) => {
    setBusy('token');
    try {
      const result = await adminApi.setAccessToken(accessToken);
      setStatus({ configured: true, hint: result.hint, updatedAt: result.updatedAt });
      setSecret(result.accessToken);
      tokenForm.resetFields();
      void message.success('Token 已更新，请复制并妥善保存');
    } catch (error) {
      void message.error(errorMessage(error));
      throw error;
    } finally {
      setBusy(null);
    }
  };
  const confirmToken = (accessToken?: string) => {
    if (status?.configured) {
      modal.confirm({
        title: '替换当前 Token？',
        content: '原 Token 会立即失效，使用它的工具需要更新凭证。',
        okText: '确认替换',
        cancelText: '取消',
        onOk: () => saveToken(accessToken),
      });
    } else {
      void saveToken(accessToken).catch(() => {});
    }
  };
  const revokeToken = () =>
    modal.confirm({
      title: '撤销当前 Token？',
      content: '使用此 Token 的 API 请求将立即失去授权。需要时可重新生成。',
      okText: '确认撤销',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy('token');
        try {
          await adminApi.revokeAccessToken();
          setStatus({ configured: false, hint: '', updatedAt: null });
          setSecret('');
          tokenForm.resetFields();
          void message.success('Token 已撤销');
        } catch (error) {
          void message.error(errorMessage(error));
          throw error;
        } finally {
          setBusy(null);
        }
      },
    });

  return (
    <Modal
      title="个人设置"
      centered
      open
      width={680}
      onCancel={() => {
        if (!busy) onClose();
      }}
      closable={!busy}
      keyboard={!busy}
      maskClosable={!busy}
      footer={
        <Button onClick={onClose} disabled={!!busy} aria-label="关闭">
          关闭
        </Button>
      }
      className="personal-settings-modal"
    >
      <div className="personal-account-summary">
        <span className="personal-account-icon">
          <SafetyCertificateOutlined />
        </span>
        <div>
          <strong>{auth.user?.nickname}</strong>
          <Typography.Text type="secondary">{auth.user?.username} · 管理员</Typography.Text>
        </div>
      </div>
      <section aria-labelledby="personal-password-title">
        <Typography.Title level={5} id="personal-password-title">
          登录密码
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="personal-section-description">
          修改后，所有登录会话与 API Token 立即失效，需要重新登录。
        </Typography.Paragraph>
        <Form
          form={passwordForm}
          name="personal-password"
          layout="vertical"
          requiredMark={false}
          disabled={!!busy}
          preserve={false}
          onFinish={changePassword}
        >
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" maxLength={72} />
          </Form.Item>
          <div className="personal-password-grid">
            <Form.Item
              name="password"
              label="新密码"
              rules={[{ required: true, message: '请输入新密码' }, passwordRule]}
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={72}
                placeholder="10–72 个 UTF-8 字节"
              />
            </Form.Item>
            <Form.Item
              name="confirmation"
              label="确认新密码"
              dependencies={['password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator: async (_, value) => {
                    if (value && value !== getFieldValue('password'))
                      throw new Error('两次输入的新密码不一致');
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" maxLength={72} />
            </Form.Item>
          </div>
          <Button
            htmlType="submit"
            loading={busy === 'password'}
            icon={<KeyOutlined aria-hidden />}
          >
            更新密码
          </Button>
        </Form>
      </section>
      <Divider />
      <section aria-labelledby="personal-token-title">
        <div className="section-heading">
          <Typography.Title level={5} id="personal-token-title">
            API 访问 Token
          </Typography.Title>
          {status && (
            <Badge
              status={status.configured ? 'success' : 'default'}
              text={status.configured ? '已配置' : '尚未配置'}
            />
          )}
        </div>
        <Typography.Paragraph type="secondary" className="personal-section-description">
          用于外部工具访问 API，拥有当前管理员的权限。完整 Token
          仅在本次设置后显示，关闭窗口后不再保留。
        </Typography.Paragraph>
        {loading ? (
          <div className="personal-token-loading">
            <Spin size="small" />
            正在读取 Token 状态
          </div>
        ) : loadError ? (
          <Alert
            type="error"
            showIcon
            title="Token 状态读取失败"
            description={loadError}
            action={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => {
                  setLoadError('');
                  setLoading(true);
                  setRevision((value) => value + 1);
                }}
              >
                重试
              </Button>
            }
          />
        ) : (
          <>
            {status?.configured && (
              <div className="personal-token-meta">
                <code>{status.hint}</code>
                <span>更新于 {formatAccountDate(status.updatedAt)}</span>
              </div>
            )}
            <Form
              form={tokenForm}
              name="personal-token"
              layout="vertical"
              requiredMark={false}
              disabled={!!busy}
              preserve={false}
              onFinish={({ accessToken }) => confirmToken(accessToken)}
            >
              <Form.Item
                name="accessToken"
                label="自定义 Token"
                rules={[
                  { required: true, message: '请输入自定义 Token，或使用“生成新 Token”' },
                  {
                    pattern: /^[\x21-\x7e]{32,128}$/,
                    message: '请输入 32–128 位无空白的可打印 ASCII 字符',
                  },
                ]}
              >
                <Input.Password
                  autoComplete="off"
                  maxLength={128}
                  placeholder="32–128 位，无空格"
                />
              </Form.Item>
              <Space wrap>
                <Button type="primary" onClick={() => confirmToken()} loading={busy === 'token'}>
                  生成新 Token
                </Button>
                <Button htmlType="submit">保存自定义 Token</Button>
                {status?.configured && (
                  <Button danger onClick={revokeToken}>
                    撤销 Token
                  </Button>
                )}
              </Space>
            </Form>
            {secret && (
              <div className="personal-token-secret">
                <Alert
                  type="success"
                  showIcon
                  title="请现在复制 Token"
                  description="完整值仅显示这一次；请勿放入公开代码或聊天记录。"
                />
                <Input.TextArea
                  aria-label="本次生成的 Token"
                  value={secret}
                  readOnly
                  rows={2}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  icon={<CopyOutlined aria-hidden />}
                  disabled={!!busy}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(secret);
                      void message.success('Token 已复制');
                    } catch {
                      void message.error('复制失败，请选中上方 Token 手动复制');
                    }
                  }}
                >
                  复制 Token
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </Modal>
  );
}
