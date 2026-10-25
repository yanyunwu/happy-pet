import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Drawer, Input, Row, Space, Table, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { errorMessage } from '../api';
import { date, gameApi, type LayoutTemplate } from '../game-api';
import LayoutEditor, { LayoutPreview } from '../components/LayoutEditor';

const fresh = (): LayoutTemplate => ({
  id: '',
  name: '新的棋盘布局',
  version: 0,
  updatedAt: '',
  layout: {
    columns: 3,
    rows: 1,
    layers: [
      {
        z: 0,
        cells: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 4, y: 0 },
        ],
      },
    ],
  },
});

export default function LevelTemplates() {
  const { message, modal } = App.useApp();
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LayoutTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    setLoading(true);
    try {
      setTemplates(await gameApi.templates());
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    gameApi
      .templates()
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch((error) => {
        if (active) message.error(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [message]);
  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const saved = await gameApi.saveTemplate(editing);
      setEditing(saved);
      await reload();
      message.success('模板已保存');
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const remove = (template: LayoutTemplate) =>
    modal.confirm({
      title: `删除“${template.name}”？`,
      content: '已经导入到关卡的布局会保留，不受删除影响。',
      okText: '删除模板',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await gameApi.deleteTemplate(template);
          await reload();
        } catch (error) {
          message.error(errorMessage(error));
          throw error;
        }
      },
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>关卡模板</Typography.Title>
          <Typography.Text type="secondary">
            把常用棋盘保存为布局，设计关卡时一键导入。
          </Typography.Text>
        </div>
        <Space>
          <Button aria-label="刷新模板" icon={<ReloadOutlined />} onClick={() => void reload()} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(fresh())}>
            新增模板
          </Button>
        </Space>
      </div>
      <Alert
        className="level-notice"
        showIcon
        type="info"
        title="模板只保存行列、层数和格子位置。萌宠配比、消除规则、道具和奖励在关卡中单独设置。"
      />
      <Card className="users-card" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={templates}
          pagination={{ pageSize: 12 }}
          scroll={{ x: 760 }}
          columns={[
            {
              title: '布局',
              width: 130,
              render: (_, item: LayoutTemplate) => (
                <div className="template-thumbnail">
                  <LayoutPreview layout={item.layout} />
                </div>
              ),
            },
            {
              title: '模板名称',
              dataIndex: 'name',
              render: (name: string) => <strong>{name}</strong>,
            },
            {
              title: '棋盘',
              render: (_, item: LayoutTemplate) =>
                `${item.layout.columns} × ${item.layout.rows} · ${item.layout.layers.length} 层`,
            },
            {
              title: '格子数量',
              render: (_, item: LayoutTemplate) =>
                item.layout.layers.reduce((n, layer) => n + layer.cells.length, 0),
            },
            { title: '修改时间', dataIndex: 'updatedAt', render: date },
            {
              title: '操作',
              width: 140,
              render: (_, item: LayoutTemplate) => (
                <Space size={0}>
                  <Button type="link" onClick={() => setEditing(structuredClone(item))}>
                    编辑
                  </Button>
                  <Button type="link" danger onClick={() => remove(item)}>
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        title={editing?.id ? '编辑布局模板' : '新增布局模板'}
        size={1000}
        open={!!editing}
        maskClosable={false}
        closable={!busy}
        onClose={() => {
          if (!busy) setEditing(null);
        }}
        extra={
          <Space>
            <Button disabled={busy} onClick={() => setEditing(null)}>
              关闭
            </Button>
            <Button type="primary" loading={busy} onClick={() => void save()}>
              保存模板
            </Button>
          </Space>
        }
      >
        {editing && (
          <>
            <label className="template-name">
              模板名称
              <Input
                aria-label="模板名称"
                disabled={busy}
                value={editing.name}
                maxLength={60}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>
            <Row gutter={[24, 24]}>
              <Col xs={24} lg={15}>
                <LayoutEditor
                  disabled={busy}
                  key={editing.id}
                  value={editing.layout}
                  onChange={(layout) => setEditing({ ...editing, layout })}
                />
              </Col>
              <Col xs={24} lg={9}>
                <Card className="template-overview" title="整体布局">
                  <LayoutPreview layout={editing.layout} />
                  <Typography.Paragraph type="secondary">
                    {editing.layout.layers.length} 层 ·{' '}
                    {editing.layout.layers.reduce((n, layer) => n + layer.cells.length, 0)} 个格子
                  </Typography.Paragraph>
                  <Typography.Text type="secondary">
                    深色为更高的层。保存后可供挑战模式和闯关模式共用。
                  </Typography.Text>
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Drawer>
    </>
  );
}
