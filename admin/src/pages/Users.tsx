import UserAssets from '../components/UserAssets';
import { useEffect, useState, type SetStateAction } from 'react';
import {
  App,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  StopOutlined,
  TeamOutlined,
  UndoOutlined,
  UserOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import {
  api,
  errorMessage,
  type CreateUser,
  type UpdateUser,
  type User,
  type UserPage,
  type UserQuery,
  type UserStats,
} from '../api';
import { useAuth } from '../auth';

const initialQuery: UserQuery = { q: '', status: '', source: '', page: 1, pageSize: 20 };
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '—';
function UserStatus({ user }: { user: User }) {
  return user.deletedAt ? (
    <Tag>已删除</Tag>
  ) : (
    <Badge
      status={user.status === 'active' ? 'success' : 'default'}
      text={user.status === 'active' ? '正常' : '已停用'}
    />
  );
}

export default function Users() {
  const { message, modal } = App.useApp();
  const auth = useAuth();
  const [query, setQueryState] = useState<UserQuery>(initialQuery);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<UserPage | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<User | null | undefined>(undefined);
  const [details, setDetails] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<CreateUser & UpdateUser>();
  const [passwordForm] = Form.useForm<{ password: string }>();
  const reload = () => {
    setLoading(true);
    setRevision((value) => value + 1);
  };
  const setQuery = (next: SetStateAction<UserQuery>) => {
    setLoading(true);
    setQueryState((previous) => ({ ...(typeof next === 'function' ? next(previous) : next) }));
  };
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api.users(query, controller.signal), api.stats(controller.signal)])
      .then(([page, nextStats]) => {
        if (!controller.signal.aborted) {
          setData(page);
          setStats(nextStats);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) void message.error(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision, message]);
  const openEditor = (user: User | null) => {
    form.resetFields();
    form.setFieldsValue(
      user
        ? { nickname: user.nickname, status: user.status, remark: user.remark || '' }
        : { nickname: '', username: '', password: '', remark: '', status: 'active' },
    );
    setEditing(user);
  };
  const confirm = (
    title: string,
    content: string,
    action: () => Promise<unknown>,
    success: string,
    danger = false,
  ) => {
    modal.confirm({
      title,
      content,
      okText: '确认',
      cancelText: '取消',
      okButtonProps: { danger },
      onOk: async () => {
        try {
          await action();
          void message.success(success);
          reload();
        } catch (error) {
          void message.error(errorMessage(error));
          throw error;
        }
      },
    });
  };
  const toggle = (user: User) =>
    confirm(
      user.status === 'active' ? `停用“${user.nickname}”？` : `启用“${user.nickname}”？`,
      user.status === 'active'
        ? '停用后无法登录，现有登录凭证立即失效。'
        : '启用后，该用户可以重新登录。',
      () =>
        api.update(user.id, {
          nickname: user.nickname,
          status: user.status === 'active' ? 'disabled' : 'active',
          remark: user.remark || '',
        }),
      '用户状态已更新',
      user.status === 'active',
    );
  const save = async () => {
    let values: CreateUser & UpdateUser;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      if (editing)
        await api.update(editing.id, {
          nickname: values.nickname,
          status: values.status,
          remark: values.remark || '',
        });
      else
        await api.create({
          username: values.username,
          password: values.password,
          nickname: values.nickname,
          remark: values.remark || '',
        });
      void message.success(editing ? '用户资料已更新' : '管理账号已创建');
      setEditing(undefined);
      reload();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  const columns: TableColumnsType<User> = [
    {
      title: '用户',
      key: 'user',
      width: 260,
      render: (_, user) => (
        <div className="user-identity">
          <Avatar
            size={40}
            src={user.avatarUrl || undefined}
            icon={<UserOutlined />}
            className={user.source === 'wechat' ? 'wechat-avatar' : 'manual-avatar'}
          />
          <div>
            <Button type="link" className="user-name" onClick={() => setDetails(user)}>
              {user.nickname}
            </Button>
            {user.id === auth.user?.id && (
              <div className="user-account-meta">
                <span className="self-label">当前账号</span>
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      title: '账号来源',
      key: 'source',
      width: 150,
      render: (_, user) => (
        <div>
          <Tag
            variant="filled"
            color={user.source === 'wechat' ? 'green' : 'default'}
            icon={user.source === 'wechat' ? <WechatOutlined /> : <SafetyCertificateOutlined />}
          >
            {user.source === 'wechat' ? '微信小游戏' : '管理账号'}
          </Tag>
          <div className="table-secondary">{user.username || '微信授权登录'}</div>
        </div>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 100,
      render: (role: User['role']) => (
        <Tag color={role === 'admin' ? 'blue' : 'default'} variant="filled">
          {role === 'admin' ? '管理员' : '用户'}
        </Tag>
      ),
    },
    { title: '状态', key: 'status', width: 100, render: (_, user) => <UserStatus user={user} /> },
    { title: '注册时间', dataIndex: 'createdAt', width: 170, render: date },
    { title: '最近登录', dataIndex: 'lastLoginAt', width: 170, render: date },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, user) =>
        user.deletedAt ? (
          <Button
            type="link"
            icon={<UndoOutlined />}
            onClick={() =>
              confirm(
                `恢复“${user.nickname}”？`,
                '恢复后保持停用，确认资料后可手动启用。',
                () => api.restore(user.id),
                '用户已恢复',
              )
            }
          >
            恢复
          </Button>
        ) : (
          <Space size={0}>
            <Button type="link" onClick={() => openEditor(user)}>
              编辑
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'detail',
                    icon: <UserOutlined />,
                    label: '查看详情',
                    onClick: () => setDetails(user),
                  },
                  {
                    key: 'status',
                    icon: user.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />,
                    label: user.status === 'active' ? '停用用户' : '启用用户',
                    onClick: () => toggle(user),
                  },
                  ...(user.username
                    ? [
                        {
                          key: 'password',
                          icon: <KeyOutlined />,
                          label: '重置密码',
                          onClick: () => {
                            passwordForm.resetFields();
                            setPasswordUser(user);
                          },
                        },
                      ]
                    : []),
                  { type: 'divider' },
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: '移入回收站',
                    danger: true,
                    onClick: () =>
                      confirm(
                        `将“${user.nickname}”移入回收站？`,
                        '该用户将无法登录，可从“已删除”筛选中恢复。',
                        () => api.remove(user.id),
                        '用户已移入回收站',
                        true,
                      ),
                  },
                ],
              }}
            >
              <Button
                type="text"
                aria-label={`更多操作：${user.nickname}`}
                icon={<EllipsisOutlined />}
              />
            </Dropdown>
          </Space>
        ),
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>用户管理</Typography.Title>
          <Typography.Text type="secondary">查看用户资料，管理账号与访问状态。</Typography.Text>
        </div>
        <Space>
          <Tooltip title="刷新数据">
            <Button
              aria-label="刷新数据"
              icon={<ReloadOutlined spin={loading} />}
              onClick={reload}
            />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>
            新增管理账号
          </Button>
        </Space>
      </div>
      <Row gutter={[18, 18]} className="stats-row">
        {[
          {
            label: '全部用户',
            value: stats?.total,
            icon: <TeamOutlined />,
            tone: 'green',
            caption: '当前用户总数',
          },
          {
            label: '微信用户',
            value: stats?.wechat,
            icon: <WechatOutlined />,
            tone: 'blue',
            caption: '来自小游戏授权',
          },
          {
            label: '今日新增',
            value: stats?.today,
            icon: <ClockCircleOutlined />,
            tone: 'amber',
            caption: '北京时间 · 今日',
          },
          {
            label: '已停用',
            value: stats?.disabled,
            icon: <StopOutlined />,
            tone: 'gray',
            caption: '暂时不可登录',
          },
        ].map((stat) => (
          <Col xs={12} xl={6} key={stat.label}>
            <Card className="stat-card">
              <div className="stat-top">
                <span>{stat.label}</span>
                <span className={`stat-icon ${stat.tone}`}>{stat.icon}</span>
              </div>
              <Statistic value={stat.value ?? '—'} />
              <div className="stat-caption">{stat.caption}</div>
            </Card>
          </Col>
        ))}
      </Row>
      <Card className="users-card" styles={{ body: { padding: 0 } }}>
        <div className="table-heading">
          <div>
            <strong>用户列表</strong>
            <span>{data ? `${data.total} 位用户` : '—'}</span>
          </div>
        </div>
        <div className="table-toolbar">
          <Input.Search
            prefix={<SearchOutlined />}
            className="user-search"
            placeholder="搜索昵称或账号"
            value={search}
            allowClear
            onChange={(event) => {
              setSearch(event.target.value);
              if (!event.target.value) setQuery((value) => ({ ...value, q: '', page: 1 }));
            }}
            onSearch={(q) => setQuery((value) => ({ ...value, q: q.trim(), page: 1 }))}
          />
          <Select
            aria-label="用户状态"
            value={query.status}
            onChange={(status) => setQuery((value) => ({ ...value, status, page: 1 }))}
            options={[
              { value: '', label: '全部状态' },
              { value: 'active', label: '正常' },
              { value: 'disabled', label: '已停用' },
              { value: 'deleted', label: '已删除' },
            ]}
          />
          <Select
            aria-label="账号来源"
            value={query.source}
            onChange={(source) => setQuery((value) => ({ ...value, source, page: 1 }))}
            options={[
              { value: '', label: '全部来源' },
              { value: 'wechat', label: '微信小游戏' },
              { value: 'manual', label: '管理账号' },
            ]}
          />
          <Button
            onClick={() => {
              setSearch('');
              setQuery(initialQuery);
            }}
          >
            重置
          </Button>
        </div>
        <Table<User>
          rowKey="id"
          dataSource={data?.items || []}
          columns={columns}
          loading={loading}
          scroll={{ x: 1100 }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的用户" />
            ),
          }}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `共 ${total} 位用户`,
            onChange: (page, pageSize) => setQuery((value) => ({ ...value, page, pageSize })),
          }}
        />
      </Card>
      <Modal
        title={editing ? '编辑用户资料' : '新增管理账号'}
        open={editing !== undefined}
        onCancel={() => setEditing(undefined)}
        onOk={() => void save()}
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        closable={!saving}
        okText="保存"
        cancelText="取消"
        forceRender
        afterClose={() => form.resetFields()}
      >
        <Form form={form} layout="vertical" requiredMark={false} className="editor-form">
          {!editing && (
            <>
              <div className="form-hint">
                管理账号可以登录后台；微信用户会在首次登录小游戏时自动创建。
              </div>
              <Form.Item
                name="username"
                label="账号"
                rules={[
                  { required: true, message: '请输入账号' },
                  {
                    pattern: /^[a-zA-Z0-9_.-]{3,32}$/,
                    message: '3–32 位字母、数字、下划线、点或横线',
                  },
                ]}
              >
                <Input autoComplete="off" maxLength={32} placeholder="请输入管理账号" />
              </Form.Item>
              <Form.Item
                name="password"
                label="初始密码"
                rules={[
                  { required: true, message: '请输入初始密码' },
                  { min: 10, message: '密码至少 10 个字符' },
                ]}
              >
                <Input.Password
                  autoComplete="new-password"
                  maxLength={72}
                  placeholder="至少 10 个字符"
                />
              </Form.Item>
            </>
          )}
          <Form.Item
            name="nickname"
            label="昵称"
            rules={[
              { required: true, whitespace: true, message: '请输入昵称' },
              { max: 32, message: '最多 32 个字符' },
            ]}
          >
            <Input maxLength={32} placeholder="用户显示的名称" />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="账号状态">
              <Select
                options={[
                  { value: 'active', label: '正常' },
                  { value: 'disabled', label: '停用' },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item name="remark" label="内部备注">
            <Input.TextArea maxLength={500} rows={3} showCount placeholder="仅管理人员可见" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`重置“${passwordUser?.nickname || ''}”的密码`}
        forceRender
        afterClose={() => passwordForm.resetFields()}
        open={!!passwordUser}
        onCancel={() => setPasswordUser(null)}
        confirmLoading={saving}
        okText="确认重置"
        cancelText="取消"
        onOk={() => {
          void passwordForm
            .validateFields()
            .then(async ({ password }) => {
              if (!passwordUser) return;
              setSaving(true);
              try {
                await api.resetPassword(passwordUser.id, password);
                void message.success('密码已重置，原登录凭证已失效');
                setPasswordUser(null);
                if (passwordUser.id === auth.user?.id)
                  window.dispatchEvent(new Event('happy-pet-auth-expired'));
              } catch (error) {
                void message.error(errorMessage(error));
              } finally {
                setSaving(false);
              }
            })
            .catch(() => {});
        }}
      >
        <Form form={passwordForm} layout="vertical" className="editor-form">
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 10, message: '密码至少 10 个字符' },
            ]}
          >
            <Input.Password autoComplete="new-password" maxLength={72} />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer title="用户详情" open={!!details} onClose={() => setDetails(null)} size={740}>
        {details && (
          <>
            <div className="detail-user">
              <Avatar size={64} src={details.avatarUrl || undefined} icon={<UserOutlined />} />
              <div>
                <Typography.Title level={4}>{details.nickname}</Typography.Title>
                <UserStatus user={details} />
              </div>
            </div>
            <Descriptions
              column={1}
              layout="vertical"
              items={[
                {
                  key: 'username',
                  label: '登录账号',
                  children: details.username || '微信授权登录',
                },
                {
                  key: 'source',
                  label: '账号来源',
                  children: details.source === 'wechat' ? '微信小游戏' : '后台创建',
                },
                {
                  key: 'role',
                  label: '角色',
                  children: details.role === 'admin' ? '管理员' : '普通用户',
                },
                { key: 'created', label: '注册时间', children: date(details.createdAt) },
                { key: 'login', label: '最近登录', children: date(details.lastLoginAt) },
                { key: 'remark', label: '内部备注', children: details.remark || '暂无备注' },
              ]}
            />
            <Button
              block
              icon={<EditOutlined />}
              onClick={() => {
                openEditor(details);
                setDetails(null);
              }}
            >
              编辑资料
            </Button>
            {details.role === 'user' && <UserAssets key={details.id} userId={details.id} />}
          </>
        )}
      </Drawer>
    </>
  );
}
