import { useState } from 'react';
import { App, Button, Card, Form, Input, Typography } from 'antd';
import { CompassOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errorMessage } from '../api';
import { ThemeToggle } from '../theme';

export default function Login() {
  const auth = useAuth();
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  if (auth.user) return <Navigate to="/users" replace />;
  return (
    <div className="auth-page">
      <Card className="auth-card">
        <div className="auth-brand">
          <span className="brand-icon">
            <CompassOutlined />
          </span>
          <strong>快乐萌宠消</strong>
          <span className="auth-theme">
            <ThemeToggle />
          </span>
        </div>
        <Typography.Title level={2}>欢迎回来</Typography.Title>
        <Typography.Paragraph type="secondary">
          登录管理控制台，管理玩家、资产、关卡与布局模板。
        </Typography.Paragraph>
        <Form
          layout="vertical"
          requiredMark={false}
          onFinish={async (values: { username: string; password: string }) => {
            setSubmitting(true);
            try {
              await auth.login(values);
            } catch (error) {
              void message.error(errorMessage(error));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item
            name="username"
            label="管理账号"
            rules={[{ required: true, message: '请输入管理账号' }]}
          >
            <Input
              prefix={<UserOutlined />}
              autoComplete="username"
              placeholder="请输入账号"
              maxLength={32}
              size="large"
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              autoComplete="current-password"
              placeholder="请输入密码"
              maxLength={72}
              size="large"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
            登录控制台
          </Button>
        </Form>
      </Card>
      <div className="auth-copyright">快乐萌宠消 · 萌宠冒险管理控制台</div>
    </div>
  );
}
