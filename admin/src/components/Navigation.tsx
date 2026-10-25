import { useState } from 'react';
import { Menu } from 'antd';
import {
  AppstoreOutlined,
  CompassOutlined,
  FlagOutlined,
  HistoryOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Link, useLocation, useNavigate } from 'react-router-dom';
export default function Navigation({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation(),
    navigate = useNavigate();
  const [keys, setKeys] = useState(['content', 'records', 'accounts']);
  return (
    <>
      <Link
        to="/users"
        className={`admin-brand${compact ? ' compact' : ''}`}
        aria-label="快乐萌宠消管理首页"
      >
        <span className="brand-icon">
          <CompassOutlined />
        </span>
        {!compact && (
          <span>
            <strong>快乐萌宠消</strong>
            <small>管理控制台</small>
          </span>
        )}
      </Link>
      <Menu
        className="admin-menu"
        mode="inline"
        inlineCollapsed={compact}
        selectedKeys={[location.pathname]}
        openKeys={compact ? undefined : keys}
        onOpenChange={setKeys}
        items={[
          {
            key: 'content',
            icon: <AppstoreOutlined />,
            label: '内容管理',
            children: [
              { key: '/levels', icon: <FlagOutlined />, label: '关卡管理' },
              { key: '/level-templates', icon: <AppstoreOutlined />, label: '关卡模板' },
            ],
          },
          {
            key: 'records',
            icon: <HistoryOutlined />,
            label: '用户数据',
            children: [{ key: '/sessions', icon: <HistoryOutlined />, label: '对局记录' }],
          },
          {
            key: 'accounts',
            icon: <TeamOutlined />,
            label: '用户与账号',
            children: [{ key: '/users', icon: <TeamOutlined />, label: '用户管理' }],
          },
          { key: '/settings', icon: <SettingOutlined aria-hidden />, label: '设置' },
        ]}
        onClick={({ key }) => {
          navigate(key);
          onNavigate?.();
        }}
      />
    </>
  );
}
