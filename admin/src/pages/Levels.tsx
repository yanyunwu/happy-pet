import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Drawer,
  Dropdown,
  Grid,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { EllipsisOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { errorMessage } from '../api';
import {
  gameApi,
  entryNames,
  defaultRules,
  modeNames,
  petNames,
  toolNames,
  date,
  type Config,
  type Level,
  type Mode,
  type BoardState,
  type Entry,
  type LayoutTemplate,
} from '../game-api';
import Board, { petImage } from '../components/Board';
import LayoutEditor from '../components/LayoutEditor';
import RuleEditor, { ruleIssue } from '../components/RuleEditor';
import LevelAnalytics from '../components/LevelAnalytics';
const copy = <T,>(v: T): T => structuredClone(v);
function fresh(entry: Entry, mode: Mode, ordinal: number): Level {
  const count = mode === 'classic' ? 3 : 4;
  return {
    id: '',
    entry,
    mode,
    ordinal,
    title: '新的萌宠冒险',
    draftVersion: 0,
    revisionId: '',
    enabled: false,
    updatedAt: '',
    config: {
      rulesVersion: 'pet-rules-2',
      rules: defaultRules(mode),
      mode,
      columns: count,
      rows: 1,
      layers: [
        {
          z: 0,
          cells: Array.from({ length: count }, (_, i) => ({ x: i * 2, y: 0 })),
        },
      ],
      counts: mode === 'fun' ? [2, 2, ...Array(13).fill(0)] : [count, ...Array(14).fill(0)],
      capacity: 7,
      freeTools: { undo: 1, shovel: 1, hint: 3, shuffle: 1 },
      rewardCoins: 20,
    },
  };
}
export default function Levels() {
  const { message, modal } = App.useApp();
  const compact = Grid.useBreakpoint().md === false;
  const [levels, setLevels] = useState<Level[]>([]),
    [analyzing, setAnalyzing] = useState<Level | null>(null),
    [loading, setLoading] = useState(true),
    [editing, setEditing] = useState<Level | null>(null),
    [entry, setEntry] = useState<Entry>('standard'),
    [templates, setTemplates] = useState<LayoutTemplate[]>([]),
    [selectedTemplate, setSelectedTemplate] = useState<string>(),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<BoardState | null>(null),
    [filter, setFilter] = useState<Mode | ''>('');
  const reload = () => {
    setLoading(true);
    return gameApi
      .levels()
      .then(setLevels)
      .catch((e) => message.error(errorMessage(e)))
      .finally(() => setLoading(false));
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
      });
    gameApi
      .levels()
      .then((v) => {
        if (active) setLevels(v);
      })
      .catch((e) => message.error(errorMessage(e)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [message]);
  const edit = (l: Level) => {
    const next = copy(l);
    next.config.rules = next.config.rules || defaultRules(next.mode);
    next.config.rulesVersion = 'pet-rules-2';
    setEditing(next);
    setSelectedTemplate(undefined);
    setPreview(null);
  };
  const nextOrdinal = (catalog: Entry, rule: Mode) =>
    1 +
    levels
      .filter((level) => level.entry === catalog && level.mode === rule)
      .reduce((last, level) => Math.max(last, level.ordinal), 0);
  const visibleLevels = levels.filter(
    (level) => level.entry === entry && (!filter || level.mode === filter),
  );
  const toggleEnabled = (l: Level) =>
    modal.confirm({
      title: l.enabled ? '下架这个关卡？' : '上架已发布版本？',
      content: '新对局将使用更新后的关卡列表，已有对局和回放保留。',
      onOk: async () => {
        try {
          await gameApi.enabled(l.id, !l.enabled);
          await reload();
        } catch (e) {
          message.error(errorMessage(e));
          throw e;
        }
      },
    });
  const update = (fn: (c: Config) => void) =>
    setEditing((old) => {
      if (!old) return old;
      const next = copy(old);
      fn(next.config);
      return next;
    });
  const total = editing?.config.layers.reduce((n, l) => n + l.cells.length, 0) ?? 0,
    counts = editing?.config.counts.reduce((a, b) => a + b, 0) ?? 0;
  const save = async () => {
    if (!editing || ruleIssue(editing.config.rules || [])) return;
    setBusy(true);
    try {
      const next = await gameApi.save(editing);
      setEditing(next);
      await reload();
      message.success('草稿已保存');
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const publish = (l: Level) =>
    modal.confirm({
      title: `发布“${l.title}”？`,
      content:
        '将校验数量、遮挡布局和通关路径。发布后新对局使用此版本，进行中的对局继续使用原版本。',
      okText: '发布关卡',
      cancelText: '取消',
      onOk: async () => {
        try {
          await gameApi.publish(l);
          await reload();
          message.success('新版本已发布');
        } catch (e) {
          message.error(errorMessage(e));
          throw e;
        }
      },
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>关卡管理</Typography.Title>
          <Typography.Text type="secondary">
            同一套关卡系统，分别管理挑战与长期闯关。
          </Typography.Text>
        </div>
        <Space>
          <Button aria-label="刷新关卡" icon={<ReloadOutlined />} onClick={() => void reload()} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() =>
              edit(fresh(entry, filter || 'classic', nextOrdinal(entry, filter || 'classic')))
            }
          >
            新增关卡
          </Button>
        </Space>
      </div>
      <Tabs
        className="catalog-tabs"
        activeKey={entry}
        onChange={(key) => setEntry(key as Entry)}
        items={Object.entries(entryNames).map(([key, label]) => ({ key, label }))}
      />
      <Alert
        type="info"
        showIcon
        title={
          entry === 'standard'
            ? '挑战模式：三个玩法入口各有两关起步关卡，每轮从第 1 关开始；后续可新增关卡扩展。'
            : '闯关模式：三个玩法入口独立保存进度，重进或失败后继续当前未通关关卡；可持续发布后续关卡。'
        }
        className="level-notice"
      />
      <Card className="users-card" styles={{ body: { padding: 0 } }}>
        <div className="table-toolbar">
          <Select
            aria-label="玩法入口"
            value={filter}
            onChange={setFilter}
            style={{ width: 200 }}
            options={[
              { value: '', label: '全部入口' },
              ...Object.entries(modeNames).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Typography.Text type="secondary">共 {visibleLevels.length} 个关卡</Typography.Text>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={visibleLevels}
          pagination={{ pageSize: 12 }}
          scroll={{ x: 960 }}
          columns={[
            {
              title: '关卡',
              width: compact ? 144 : 190,
              render: (_, l: Level) => (
                <>
                  <strong>{l.title}</strong>
                  <div className="table-secondary">第 {l.ordinal} 关</div>
                </>
              ),
            },
            { title: '入口', dataIndex: 'mode', render: (m: Mode) => modeNames[m] },
            {
              title: '消除规则',
              render: (_, l: Level) =>
                (l.config.rules || defaultRules(l.mode))
                  .map((pattern) => pattern.join('+'))
                  .join(' / '),
            },
            {
              title: '棋盘',
              render: (_, l: Level) =>
                `${l.config.columns} × ${l.config.rows} · ${l.config.layers.length} 层`,
            },
            {
              title: '萌宠数量',
              render: (_, l: Level) =>
                `${l.config.counts.reduce((a, b) => a + b, 0)} 块 / ${l.config.counts.filter((n) => n > 0).length} 种`,
            },
            {
              title: '状态',
              render: (_, l: Level) => (
                <Tag color={l.enabled ? 'green' : 'default'}>
                  {l.enabled ? '已上架' : l.revisionId ? '已下架' : '草稿'}
                </Tag>
              ),
            },
            { title: '修改时间', dataIndex: 'updatedAt', render: date },
            {
              title: '操作',
              fixed: 'right',
              width: compact ? 136 : 310,
              render: (_, l: Level) => (
                <Space size={0}>
                  <Button
                    type="link"
                    size={compact ? 'small' : 'middle'}
                    onClick={() => setAnalyzing(l)}
                  >
                    数据分析
                  </Button>
                  {compact ? (
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          { key: 'edit', label: '编辑', onClick: () => edit(l) },
                          {
                            key: 'publish',
                            label: '发布',
                            disabled: !!ruleIssue(l.config.rules || defaultRules(l.mode)),
                            onClick: () => publish(l),
                          },
                          ...(l.revisionId
                            ? [
                                {
                                  key: 'enabled',
                                  label: l.enabled ? '下架' : '上架',
                                  onClick: () => {
                                    toggleEnabled(l);
                                  },
                                },
                              ]
                            : []),
                        ],
                      }}
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<EllipsisOutlined />}
                        aria-label={`${l.title}的更多操作`}
                      />
                    </Dropdown>
                  ) : (
                    <>
                      <Button type="link" onClick={() => edit(l)}>
                        编辑
                      </Button>
                      <Button
                        type="link"
                        disabled={!!ruleIssue(l.config.rules || defaultRules(l.mode))}
                        onClick={() => publish(l)}
                      >
                        发布
                      </Button>
                      {l.revisionId && (
                        <Button type="link" onClick={() => toggleEnabled(l)}>
                          {l.enabled ? '下架' : '上架'}
                        </Button>
                      )}
                    </>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
      {analyzing && (
        <LevelAnalytics key={analyzing.id} level={analyzing} onClose={() => setAnalyzing(null)} />
      )}
      <Drawer
        title={`${editing ? entryNames[editing.entry] : ''} · ${editing?.id ? '编辑关卡草稿' : '新增关卡'}`}
        size={1160}
        open={!!editing}
        onClose={() => {
          if (!busy) setEditing(null);
        }}
        closable={!busy}
        maskClosable={false}
        extra={
          <Space>
            <Button disabled={busy} onClick={() => setEditing(null)}>
              关闭
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={busy || (!!editing && !!ruleIssue(editing.config.rules || []))}
              onClick={() => void save()}
            >
              保存草稿
            </Button>
          </Space>
        }
      >
        {editing && (
          <div className="level-editor">
            <Row gutter={[24, 24]}>
              <Col xs={24} lg={14}>
                <div className="level-fields">
                  <label>
                    关卡名称
                    <Input
                      aria-label="关卡名称"
                      disabled={busy}
                      value={editing.title}
                      maxLength={60}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    />
                  </label>
                  <label>
                    模式类型
                    <Select
                      aria-label="模式类型"
                      value={editing.entry}
                      disabled={busy || !!editing.id}
                      onChange={(catalog: Entry) =>
                        setEditing({
                          ...editing,
                          entry: catalog,
                          ordinal: nextOrdinal(catalog, editing.mode),
                        })
                      }
                      options={Object.entries(entryNames).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                    />
                  </label>
                  <label>
                    所属入口
                    <Select
                      aria-label="所属入口"
                      value={editing.mode}
                      disabled={busy || !!editing.id}
                      onChange={(mode: Mode) =>
                        setEditing({
                          ...editing,
                          mode,
                          ordinal: nextOrdinal(editing.entry, mode),
                          config: { ...editing.config, mode },
                        })
                      }
                      options={Object.entries(modeNames).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                    />
                  </label>
                  <label>
                    顺序
                    <InputNumber
                      min={1}
                      max={2147483647}
                      precision={0}
                      value={editing.ordinal}
                      disabled={busy || !!editing.id}
                      onChange={(v) => setEditing({ ...editing, ordinal: v ?? 1 })}
                    />
                  </label>
                </div>
                <RuleEditor
                  key={`${editing.id}-${editing.draftVersion}`}
                  value={editing.config.rules || defaultRules(editing.mode)}
                  disabled={busy}
                  onChange={(rules) => {
                    update((config) => {
                      config.rules = rules;
                      config.rulesVersion = 'pet-rules-2';
                    });
                    setPreview(null);
                  }}
                />
                <Space wrap className="editor-actions">
                  <Button
                    disabled={busy || !!ruleIssue(editing.config.rules || [])}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        setPreview(await gameApi.preview(editing.config, 2026));
                        message.success('数量、布局和通关路径校验通过');
                      } catch (e) {
                        message.error(errorMessage(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    校验并预览
                  </Button>
                </Space>
                <div className="template-import">
                  <Select
                    aria-label="选择布局模板"
                    disabled={busy}
                    placeholder="选择布局模板"
                    value={selectedTemplate}
                    onChange={setSelectedTemplate}
                    style={{ width: 240 }}
                    showSearch
                    optionFilterProp="label"
                    options={templates.map((template) => ({
                      value: template.id,
                      label: template.name,
                    }))}
                  />
                  <Button
                    disabled={busy || !selectedTemplate}
                    onClick={() => {
                      const template = templates.find((item) => item.id === selectedTemplate);
                      if (!template) return;
                      modal.confirm({
                        title: '导入这个布局？',
                        content: '会替换当前草稿的棋盘行列与格子；保留萌宠数量、规则、奖励和道具。',
                        okText: '确认导入',
                        cancelText: '取消',
                        onOk: () => {
                          update((config) => Object.assign(config, copy(template.layout)));
                          setPreview(null);
                        },
                      });
                    }}
                  >
                    导入布局
                  </Button>
                  <Typography.Text type="secondary">导入为独立副本</Typography.Text>
                </div>
                <LayoutEditor
                  disabled={busy}
                  key={editing.id}
                  value={{
                    columns: editing.config.columns,
                    rows: editing.config.rows,
                    layers: editing.config.layers,
                  }}
                  onChange={(layout) => {
                    update((config) => Object.assign(config, layout));
                    setPreview(null);
                  }}
                />
                <Alert
                  type={total === counts ? 'success' : 'warning'}
                  showIcon
                  title={`格子 ${total} 个 · 萌宠 ${counts} 块 · ${editing.config.counts.filter((n) => n > 0).length} 种`}
                  description="发布时总数必须相等，并按上方所选组合校验数量与真实通关路径。所属入口只决定首页按钮，不会覆盖消除规则。"
                />
              </Col>
              <Col xs={24} lg={10}>
                <Typography.Title level={5}>15 种萌宠配比</Typography.Title>
                <div className="pet-counts">
                  {petNames.map((name, i) => (
                    <label key={name}>
                      <img src={petImage(i)} alt="" />
                      <span>{name}</span>
                      <InputNumber
                        aria-label={`${name}数量`}
                        disabled={busy}
                        min={0}
                        max={192}
                        precision={0}
                        value={editing.config.counts[i] ?? 0}
                        onChange={(v) =>
                          update((c) => {
                            c.counts[i] = v ?? 0;
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <Typography.Title level={5}>每局免费道具</Typography.Title>
                <div className="tool-inputs">
                  {Object.entries(toolNames).map(([key, name]) => (
                    <label key={key}>
                      {name}
                      <InputNumber
                        aria-label={`${name}免费次数`}
                        disabled={busy}
                        min={0}
                        max={9}
                        precision={0}
                        value={editing.config.freeTools[key]}
                        onChange={(v) =>
                          update((c) => {
                            c.freeTools[key] = v ?? 0;
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className="reward-input">
                  首次通关金币奖励
                  <InputNumber
                    aria-label="首次通关金币奖励"
                    disabled={busy}
                    min={0}
                    max={10000}
                    precision={0}
                    value={editing.config.rewardCoins}
                    onChange={(v) =>
                      update((c) => {
                        c.rewardCoins = v ?? 0;
                      })
                    }
                  />
                </label>
                <Typography.Paragraph type="secondary">
                  重复通关保留记录，每关仅首次通关获得奖励。
                  {editing.entry === 'campaign'
                    ? '闯关先用免费次数，耗尽后可继续消耗背包，直至库存用完。'
                    : '挑战仅允许使用本关免费次数，耗尽后不可使用背包道具。'}
                </Typography.Paragraph>
              </Col>
            </Row>
          </div>
        )}
      </Drawer>
      <Modal
        title="棋盘预览 · 固定种子 2026"
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={null}
        width={540}
      >
        {preview ? <Board state={preview} /> : <Spin />}
      </Modal>
    </>
  );
}
