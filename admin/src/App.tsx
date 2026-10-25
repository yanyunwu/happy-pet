import { useEffect, useState } from 'react';
import {
  App as AntApp,
  Avatar,
  Breadcrumb,
  Button,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Spin,
  Tooltip,
} from 'antd';
import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { errorMessage } from './api';
import { ThemeToggle } from './theme';
import Login from './pages/Login';
import Users from './pages/Users';
import Levels from './pages/Levels';
import LevelTemplates from './pages/LevelTemplates';
import Sessions from './pages/Sessions';
import Navigation from './components/Navigation';
const names: Record<string, string> = {
  users: '用户管理',
  levels: '关卡管理',
  'level-templates': '关卡模板',
  sessions: '对局记录',
};
function ConsoleLayout() {
  const auth = useAuth(),
    { message } = AntApp.useApp(),
    screens = Grid.useBreakpoint();
  const mobile = screens.lg === false;
  const [collapsed, setCollapsed] = useState(false),
    [open, setOpen] = useState(false);
  const location = useLocation(),
    key = location.pathname.split('/')[1] || 'users';
  useEffect(() => {
    document.title = `${names[key] || '管理后台'} · 快乐萌宠消`;
  }, [key]);
  if (!auth.user) return <Navigate to="/login" replace />;
  return (
    <Layout className="admin-layout">
      {!mobile && (
        <Layout.Sider
          className="admin-sider"
          theme="light"
          width={224}
          collapsedWidth={76}
          collapsed={collapsed}
          trigger={null}
        >
          <Navigation compact={collapsed} />
          {!collapsed && (
            <div className="sider-bottom">
              <span className="version-dot" />
              起步版 <span>0.4.0</span>
            </div>
          )}
        </Layout.Sider>
      )}
      <Drawer
        title="管理导航"
        placement="left"
        open={mobile && open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: 0 } }}
        size={260}
        className="mobile-navigation"
      >
        <Navigation onNavigate={() => setOpen(false)} />
      </Drawer>
      <Layout className="admin-main">
        <Layout.Header className="admin-header">
          <div className="header-left">
            <Tooltip title="展开或收起导航">
              <Button
                type="text"
                aria-label="切换导航"
                icon={collapsed || mobile ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => (mobile ? setOpen(true) : setCollapsed(!collapsed))}
              />
            </Tooltip>
            <Breadcrumb
              items={[
                {
                  title:
                    key === 'users' ? '用户与账号' : key === 'sessions' ? '用户数据' : '内容配置',
                },
                { title: names[key] },
              ]}
            />
          </div>
          <div className="header-right">
            <ThemeToggle />
            <div className="header-divider" />
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: '退出登录',
                    onClick: () => void auth.logout().catch((e) => message.error(errorMessage(e))),
                  },
                ],
              }}
            >
              <Button type="text" className="account-button" aria-label="账户菜单">
                <Avatar size={30} icon={<UserOutlined />} />
                <span>{auth.user.nickname}</span>
              </Button>
            </Dropdown>
          </div>
        </Layout.Header>
        <Layout.Content className="admin-content">
          <Routes>
            <Route path="/users" element={<Users />} />
            <Route path="/levels" element={<Levels />} />
            <Route path="/level-templates" element={<LevelTemplates />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="*" element={<Navigate to="/users" replace />} />
          </Routes>
        </Layout.Content>
        <Layout.Footer className="admin-footer">
          快乐萌宠消 <span>·</span> 管理控制台
        </Layout.Footer>
      </Layout>
    </Layout>
  );
}
function Router() {
  const { loading } = useAuth();
  if (loading)
    return (
      <div className="loading-page">
        <Spin size="large" />
      </div>
    );
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<ConsoleLayout />} />
    </Routes>
  );
}
export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
