import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Typography,
} from 'antd';
import { Link } from 'react-router-dom';
import { gameApi, toolNames, date, type Assets, type Ledger } from '../game-api';
import { errorMessage } from '../api';
export default function UserAssets({ userId }: { userId: string }) {
  const { message } = App.useApp();
  const [a, setA] = useState<Assets | null>(null),
    [ledger, setLedger] = useState<Ledger[]>([]),
    [edit, setEdit] = useState(false),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState('');
  const [form] = Form.useForm();
  const refresh = () =>
    Promise.all([gameApi.assets(userId), gameApi.ledger(userId)]).then(([v, l]) => {
      setA(v);
      setLedger(l);
    });
  useEffect(() => {
    let active = true;
    Promise.all([gameApi.assets(userId), gameApi.ledger(userId)])
      .then(([v, l]) => {
        if (active) {
          setA(v);
          setLedger(l);
        }
      })
      .catch((e) => message.error(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [userId, message]);
  return (
    <div className="asset-section">
      <div className="section-heading">
        <Typography.Title level={4}>个人资产与背包</Typography.Title>
        <Space>
          <Link to={`/sessions?userId=${userId}`}>查看对局</Link>
          <Button
            onClick={() => {
              setKey(crypto.randomUUID());
              form.resetFields();
              setEdit(true);
            }}
          >
            调整资产
          </Button>
        </Space>
      </div>
      <div className="asset-grid">
        <Card size="small">
          <Statistic title="萌宠金币" value={a?.coins ?? '—'} />
        </Card>
        {Object.entries(toolNames).map(([id, name]) => (
          <Card size="small" key={id}>
            <Statistic title={name} value={a?.bag[id] ?? '—'} />
          </Card>
        ))}
      </div>
      <Typography.Paragraph type="secondary">
        已签到 {a?.signInCount ?? 0} 次 · 最近签到 {a?.signedOn || '暂无'}
      </Typography.Paragraph>
      <Typography.Title level={5}>资产流水 · 最近 100 条</Typography.Title>
      <Table
        rowKey="id"
        size="small"
        dataSource={ledger}
        pagination={{ pageSize: 8 }}
        scroll={{ x: 550 }}
        columns={[
          {
            title: '资产',
            dataIndex: 'asset',
            render: (v) => (v === 'coins' ? '萌宠金币' : toolNames[v]),
          },
          {
            title: '变动',
            dataIndex: 'delta',
            render: (v) => (
              <Typography.Text type={v > 0 ? 'success' : 'danger'}>
                {v > 0 ? '+' : ''}
                {v}
              </Typography.Text>
            ),
          },
          { title: '余额', dataIndex: 'balance' },
          { title: '原因', dataIndex: 'reason' },
          { title: '时间', dataIndex: 'createdAt', render: date },
        ]}
      />
      <Modal
        title="调整用户资产"
        open={edit}
        onCancel={() => setEdit(false)}
        confirmLoading={busy}
        okText="保存调整"
        cancelText="取消"
        onOk={() =>
          void form
            .validateFields()
            .then(async (v) => {
              setBusy(true);
              try {
                await gameApi.adjust(userId, { ...v, requestId: key });
                await refresh();
                setEdit(false);
                message.success('资产已更新并记录流水');
              } catch (e) {
                message.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            })
            .catch(() => {})
        }
      >
        <Form form={form} layout="vertical" initialValues={{ asset: 'coins', delta: 10 }}>
          <Form.Item name="asset" label="资产类型" rules={[{ required: true }]}>
            <Select
              options={Object.entries({ coins: '萌宠金币', ...toolNames }).map(
                ([value, label]) => ({ value, label }),
              )}
            />
          </Form.Item>
          <Form.Item
            name="delta"
            label="调整数量（正数增加，负数扣减）"
            rules={[{ required: true }]}
          >
            <InputNumber min={-1000000} max={1000000} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="调整原因" rules={[{ required: true, min: 2, max: 200 }]}>
            <Input.TextArea rows={3} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
