import { useEffect, useState, type SetStateAction } from 'react';
import {
  App,
  Avatar,
  Badge,
  Button,
  Card,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  StopOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import {
  adminApi,
  type AccountPage,
  type AccountQuery,
  type CreateAccount,
  type UpdateAccount,
} from '../admin-api';
import { errorMessage, type AdminAccount } from '../api';
import { useAuth } from '../auth';
import { formatAccountDate, passwordRule } from '../credentials';

const initialQuery: AccountQuery = { q: '', status: '', page: 1, pageSize: 20 };
function AccountStatus({ account }: { account: AdminAccount }) {
  return account.deletedAt ? (
    <Tag>已删除</Tag>
  ) : (
    <Badge
      status={account.status === 'active' ? 'success' : 'default'}
      text={account.status === 'active' ? '正常' : '已停用'}
    />
  );
}

export default function Accounts() {
  const { message, modal } = App.useApp();
  const auth = useAuth();
  const [query, setQueryState] = useState(initialQuery);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AccountPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<AdminAccount | null | undefined>(undefined);
  const [details, setDetails] = useState<AdminAccount | null>(null);
  const [passwordAccount, setPasswordAccount] = useState<AdminAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<CreateAccount & UpdateAccount>();
  const [passwordForm] = Form.useForm<{ password: string; confirmation: string }>();
  const reload = () => {
    setLoading(true);
    setLoadError('');
    setRevision((value) => value + 1);
  };
  const setQuery = (next: SetStateAction<AccountQuery>) => {
    setLoading(true);
    setLoadError('');
    setQueryState((previous) => (typeof next === 'function' ? next(previous) : next));
  };
  useEffect(() => {
    const controller = new AbortController();
    adminApi
      .accounts(query, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setData(page);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision]);

  const openEditor = (account: AdminAccount | null) => {
    form.resetFields();
    form.setFieldsValue(
      account
        ? { nickname: account.nickname, status: account.status, remark: account.remark || '' }
        : { nickname: '', username: '', password: '', remark: '', status: 'active' },
    );
    setEditing(account);
  };
  const closeEditor = () => {
    if (!saving) {
      form.resetFields();
      setEditing(undefined);
    }
  };
  const save = async () => {
    let values: CreateAccount & UpdateAccount;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      if (editing)
        await adminApi.update(editing.id, {
          nickname: values.nickname,
          status: values.status,
          remark: values.remark || '',
        });
      else
        await adminApi.create({
          username: values.username,
          password: values.password,
          nickname: values.nickname,
          remark: values.remark || '',
        });
      void message.success(editing ? '管理员资料已更新' : '管理员账号已创建');
      form.resetFields();
      setEditing(undefined);
      reload();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
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
  const toggle = (account: AdminAccount) =>
    confirm(
      `${account.status === 'active' ? '停用' : '启用'}“${account.nickname}”？`,
      account.status === 'active'
        ? '停用后，所有登录会话和 API Token 立即失效。'
        : '启用后，该管理员可以重新登录。',
      () =>
        adminApi.update(account.id, {
          nickname: account.nickname,
          status: account.status === 'active' ? 'disabled' : 'active',
          remark: account.remark || '',
        }),
      '管理员状态已更新',
      account.status === 'active',
    );
  const columns: TableColumnsType<AdminAccount> = [
    {
      title: '管理员',
      key: 'account',
      width: 250,
      render: (_, account) => (
        <div className="user-identity">
          <Avatar size={40} icon={<SafetyCertificateOutlined />} className="manual-avatar" />
          <div>
            <Button type="link" className="user-name" onClick={() => setDetails(account)}>
              {account.nickname}
            </Button>
            <div className="user-account-meta">
              {account.id === auth.user?.id ? (
                <span className="self-label">当前账号</span>
              ) : (
                <span className="table-secondary">{account.username}</span>
              )}
            </div>
          </div>
        </div>
      ),
    },
    { title: '登录账号', dataIndex: 'username', width: 170 },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_, account) => <AccountStatus account={account} />,
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: formatAccountDate },
    { title: '最近登录', dataIndex: 'lastLoginAt', width: 170, render: formatAccountDate },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, account) =>
        account.deletedAt ? (
          <Button
            type="link"
            icon={<UndoOutlined />}
            onClick={() =>
              confirm(
                `恢复“${account.nickname}”？`,
                '恢复后保持停用，核对资料后可手动启用。',
                () => adminApi.restore(account.id),
                '管理员已恢复',
              )
            }
          >
            恢复
          </Button>
        ) : (
          <Space size={0}>
            <Button type="link" onClick={() => openEditor(account)}>
              编辑
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'details',
                    icon: <SafetyCertificateOutlined />,
                    label: '查看详情',
                    onClick: () => setDetails(account),
                  },
                  {
                    key: 'status',
                    icon: account.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />,
                    label: account.status === 'active' ? '停用管理员' : '启用管理员',
                    disabled: account.id === auth.user?.id,
                    onClick: () => toggle(account),
                  },
                  {
                    key: 'password',
                    icon: <KeyOutlined />,
                    label: account.id === auth.user?.id ? '本人密码请在个人设置修改' : '重置密码',
                    disabled: account.id === auth.user?.id,
                    onClick: () => {
                      passwordForm.resetFields();
                      setPasswordAccount(account);
                    },
                  },
                  { type: 'divider' },
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: '移入回收站',
                    danger: true,
                    disabled: account.id === auth.user?.id,
                    onClick: () =>
                      confirm(
                        `将“${account.nickname}”移入回收站？`,
                        '所有登录会话和 API Token 将立即失效。可从“已删除”筛选中恢复。',
                        () => adminApi.remove(account.id),
                        '管理员已移入回收站',
                        true,
                      ),
                  },
                ],
              }}
            >
              <Button
                type="text"
                aria-label={`更多操作：${account.nickname}`}
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
          <Typography.Title level={2}>管理员账号</Typography.Title>
          <Typography.Text type="secondary">
            管理后台访问权限与账号状态，玩家资料在用户管理中维护。
          </Typography.Text>
        </div>
        <Space>
          <Tooltip title="刷新数据">
            <Button
              aria-label="刷新管理员"
              icon={<ReloadOutlined spin={loading} />}
              onClick={reload}
            />
          </Tooltip>
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => openEditor(null)}
          >
            新增管理员
          </Button>
        </Space>
      </div>
      <div className="account-management-note">
        <SafetyCertificateOutlined />
        <span>管理员可管理全部后台数据。为保证持续访问，当前账号无法在此停用或删除。</span>
      </div>
      <Card className="users-card" styles={{ body: { padding: 0 } }}>
        <div className="table-heading">
          <div>
            <strong>管理员列表</strong>
            <span>{data ? `${data.total} 位管理员` : '—'}</span>
          </div>
        </div>
        <div className="table-toolbar">
          <Input.Search
            prefix={<SearchOutlined />}
            className="user-search"
            placeholder="搜索昵称或管理员账号"
            aria-label="搜索管理员"
            value={search}
            allowClear
            onChange={(event) => {
              setSearch(event.target.value);
              if (!event.target.value) setQuery((value) => ({ ...value, q: '', page: 1 }));
            }}
            onSearch={(q) => setQuery((value) => ({ ...value, q: q.trim(), page: 1 }))}
          />
          <Select
            aria-label="管理员状态"
            value={query.status}
            onChange={(status) => setQuery((value) => ({ ...value, status, page: 1 }))}
            options={[
              { value: '', label: '全部状态' },
              { value: 'active', label: '正常' },
              { value: 'disabled', label: '已停用' },
              { value: 'deleted', label: '已删除' },
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
        {loadError && (
          <div className="account-load-error">
            <Typography.Text type="danger">{loadError}</Typography.Text>
            <Button size="small" onClick={reload}>
              重新加载
            </Button>
          </div>
        )}
        <Table<AdminAccount>
          rowKey="id"
          dataSource={data?.items || []}
          columns={columns}
          loading={loading}
          scroll={{ x: 1020 }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的管理员" />
            ),
          }}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `共 ${total} 位管理员`,
            onChange: (page, pageSize) => setQuery((value) => ({ ...value, page, pageSize })),
          }}
        />
      </Card>
      <Modal
        title={editing ? '编辑管理员资料' : '新增管理员'}
        open={editing !== undefined}
        onCancel={closeEditor}
        onOk={() => void save()}
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        closable={!saving}
        keyboard={!saving}
        maskClosable={!saving}
        okText="保存"
        okButtonProps={{ 'aria-label': '保存' }}
        cancelText="取消"
        forceRender
      >
        <Form
          form={form}
          name="admin-account-editor"
          layout="vertical"
          requiredMark={false}
          className="editor-form"
          disabled={saving}
        >
          {!editing && (
            <>
              <div className="form-hint">新管理员将拥有后台管理与 API 访问权限。</div>
              <Form.Item
                name="username"
                label="管理员账号"
                rules={[
                  { required: true, message: '请输入管理员账号' },
                  {
                    pattern: /^[a-zA-Z0-9_.-]{3,32}$/,
                    message: '3–32 位字母、数字、下划线、点或横线',
                  },
                ]}
              >
                <Input autoComplete="off" maxLength={32} placeholder="用于登录管理控制台" />
              </Form.Item>
              <Form.Item
                name="password"
                label="初始密码"
                rules={[{ required: true, message: '请输入初始密码' }, passwordRule]}
              >
                <Input.Password
                  autoComplete="new-password"
                  maxLength={72}
                  placeholder="10–72 个 UTF-8 字节"
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
            <Input maxLength={32} placeholder="管理员显示的名称" />
          </Form.Item>
          {editing && (
            <Form.Item
              name="status"
              label="账号状态"
              extra={
                editing.id === auth.user?.id
                  ? '当前账号保持可用，可由其他管理员调整状态。'
                  : undefined
              }
            >
              <Select
                disabled={saving || editing.id === auth.user?.id}
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
        title={`重置“${passwordAccount?.nickname || ''}”的密码`}
        open={!!passwordAccount}
        destroyOnHidden
        onCancel={() => {
          if (!saving) {
            passwordForm.resetFields();
            setPasswordAccount(null);
          }
        }}
        closable={!saving}
        keyboard={!saving}
        maskClosable={!saving}
        cancelButtonProps={{ disabled: saving }}
        confirmLoading={saving}
        okText="确认重置"
        cancelText="取消"
        onOk={() => {
          void passwordForm
            .validateFields()
            .then(async ({ password }) => {
              if (!passwordAccount) return;
              setSaving(true);
              try {
                await adminApi.resetPassword(passwordAccount.id, password);
                passwordForm.resetFields();
                setPasswordAccount(null);
                void message.success('密码已重置，原登录会话与 Token 已失效');
              } catch (error) {
                void message.error(errorMessage(error));
              } finally {
                setSaving(false);
              }
            })
            .catch(() => {});
        }}
      >
        <div className="form-hint">重置后，该管理员需要重新登录，并重新设置 API Token。</div>
        <Form
          form={passwordForm}
          name="admin-account-password"
          layout="vertical"
          requiredMark={false}
          className="editor-form"
          disabled={saving}
        >
          <Form.Item
            name="password"
            label="新密码"
            rules={[{ required: true, message: '请输入新密码' }, passwordRule]}
          >
            <Input.Password autoComplete="new-password" maxLength={72} />
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
        </Form>
      </Modal>
      <Drawer title="管理员详情" open={!!details} onClose={() => setDetails(null)} size={520}>
        {details && (
          <>
            <div className="detail-user">
              <Avatar size={64} icon={<SafetyCertificateOutlined />} />
              <div>
                <Typography.Title level={4}>{details.nickname}</Typography.Title>
                <AccountStatus account={details} />
              </div>
            </div>
            <Descriptions
              column={1}
              layout="vertical"
              items={[
                { key: 'username', label: '管理员账号', children: details.username },
                { key: 'id', label: '账号 ID', children: details.id },
                {
                  key: 'created',
                  label: '创建时间',
                  children: formatAccountDate(details.createdAt),
                },
                {
                  key: 'login',
                  label: '最近登录',
                  children: formatAccountDate(details.lastLoginAt),
                },
                { key: 'remark', label: '内部备注', children: details.remark || '暂无备注' },
              ]}
            />
          </>
        )}
      </Drawer>
    </>
  );
}
