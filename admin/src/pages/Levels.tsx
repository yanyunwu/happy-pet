import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { errorMessage } from '../api';
import {
  gameApi,
  modeNames,
  petNames,
  toolNames,
  date,
  type Config,
  type Level,
  type Mode,
  type BoardState,
} from '../game-api';
import Board, { petImage } from '../components/Board';
const copy = <T,>(v: T): T => structuredClone(v);
function fresh(): Level {
  return {
    id: '',
    mode: 'classic',
    ordinal: 3,
    title: '新的萌宠冒险',
    draftVersion: 0,
    revisionId: '',
    enabled: false,
    updatedAt: '',
    config: {
      rulesVersion: 'pet-rules-1',
      mode: 'classic',
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
      counts: [3, ...Array(14).fill(0)],
      capacity: 7,
      freeTools: { undo: 1, shovel: 1, hint: 3, shuffle: 1 },
      rewardCoins: 20,
    },
  };
}
export default function Levels() {
  const { message, modal } = App.useApp();
  const [levels, setLevels] = useState<Level[]>([]),
    [loading, setLoading] = useState(true),
    [editing, setEditing] = useState<Level | null>(null),
    [z, setZ] = useState(0),
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
    setEditing(copy(l));
    setZ(l.config.layers[0]?.z ?? 0);
    setPreview(null);
  };
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
    if (!editing) return;
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
          <Typography.Title level={2}>闯关关卡</Typography.Title>
          <Typography.Text type="secondary">
            按模式连续闯关，逐层配置棋盘与萌宠数量。
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => edit(fresh())}>
            新增关卡
          </Button>
        </Space>
      </div>
      <Alert
        type="info"
        showIcon
        title="三种模式独立排列关卡，玩家通过后自动进入下一关；失败重试从本模式第一关开始。"
        className="level-notice"
      />
      <Card className="users-card" styles={{ body: { padding: 0 } }}>
        <div className="table-toolbar">
          <Select
            aria-label="关卡模式"
            value={filter}
            onChange={setFilter}
            style={{ width: 200 }}
            options={[
              { value: '', label: '全部模式' },
              ...Object.entries(modeNames).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Typography.Text type="secondary">共 {levels.length} 个关卡</Typography.Text>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={levels.filter((l) => !filter || l.mode === filter)}
          pagination={{ pageSize: 12 }}
          scroll={{ x: 960 }}
          columns={[
            {
              title: '关卡',
              render: (_, l: Level) => (
                <>
                  <strong>{l.title}</strong>
                  <div className="table-secondary">第 {l.ordinal} 关</div>
                </>
              ),
            },
            { title: '模式', dataIndex: 'mode', render: (m: Mode) => modeNames[m] },
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
              width: 235,
              render: (_, l: Level) => (
                <Space size={0}>
                  <Button type="link" onClick={() => edit(l)}>
                    编辑
                  </Button>
                  <Button type="link" onClick={() => publish(l)}>
                    发布
                  </Button>
                  {l.revisionId && (
                    <Button
                      type="link"
                      onClick={() =>
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
                        })
                      }
                    >
                      {l.enabled ? '下架' : '上架'}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        title={editing?.id ? '编辑关卡草稿' : '新增关卡'}
        size={1160}
        open={!!editing}
        onClose={() => setEditing(null)}
        maskClosable={false}
        extra={
          <Space>
            <Button onClick={() => setEditing(null)}>关闭</Button>
            <Button type="primary" loading={busy} onClick={() => void save()}>
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
                      value={editing.title}
                      maxLength={60}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    />
                  </label>
                  <label>
                    模式
                    <Select
                      value={editing.mode}
                      disabled={!!editing.id}
                      onChange={(mode: Mode) =>
                        setEditing({ ...editing, mode, config: { ...editing.config, mode } })
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
                      max={9999}
                      value={editing.ordinal}
                      disabled={!!editing.id}
                      onChange={(v) => setEditing({ ...editing, ordinal: v ?? 1 })}
                    />
                  </label>
                </div>
                <Space wrap className="editor-actions">
                  {[1, 2].map((n) => (
                    <Button
                      key={n}
                      onClick={() => {
                        const src = levels.find((l) => l.mode === editing.mode && l.ordinal === n);
                        if (src) {
                          update((c) => Object.assign(c, copy(src.config)));
                          setZ(0);
                        }
                      }}
                    >
                      {n === 1 ? '使用入门模板' : '使用挑战模板'}
                    </Button>
                  ))}
                  <Button
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
                <Space wrap>
                  <label>
                    列{' '}
                    <InputNumber
                      min={1}
                      max={6}
                      value={editing.config.columns}
                      onChange={(v) =>
                        update((c) => {
                          c.columns = v ?? 1;
                        })
                      }
                    />
                  </label>
                  <label>
                    行{' '}
                    <InputNumber
                      min={1}
                      max={8}
                      value={editing.config.rows}
                      onChange={(v) =>
                        update((c) => {
                          c.rows = v ?? 1;
                        })
                      }
                    />
                  </label>
                  <Select
                    aria-label="编辑层"
                    value={z}
                    onChange={setZ}
                    options={editing.config.layers.map((l) => ({
                      value: l.z,
                      label: `第 ${l.z + 1} 层 · ${l.cells.length} 块`,
                    }))}
                  />
                  <Button
                    disabled={editing.config.layers.length >= 8}
                    onClick={() => {
                      const next = Array.from({ length: 8 }, (_, i) => i).find(
                        (n) => !editing.config.layers.some((l) => l.z === n),
                      )!;
                      update((c) => c.layers.push({ z: next, cells: [] }));
                      setZ(next);
                    }}
                  >
                    添加一层
                  </Button>
                </Space>
                <Typography.Paragraph type="secondary" className="grid-caption">
                  点击网格放置或移除方块。小圆点间隔为半块，可做半格错位；同层不能重叠，高层覆盖低层。
                </Typography.Paragraph>
                <div className="grid-editor-scroll">
                  <div
                    className="grid-editor"
                    style={{ width: editing.config.columns * 64, height: editing.config.rows * 64 }}
                  >
                    {editing.config.layers
                      .filter((l) => l.z < z)
                      .map((l) =>
                        l.cells.map((p, i) => (
                          <div
                            className="grid-under"
                            key={`${l.z}-${i}`}
                            style={{ left: p.x * 32, top: p.y * 32 }}
                          >
                            {l.z + 1}
                          </div>
                        )),
                      )}
                    {Array.from({ length: editing.config.rows * 2 - 1 }, (_, y) =>
                      Array.from({ length: editing.config.columns * 2 - 1 }, (_, x) => {
                        const layer = editing.config.layers.find((l) => l.z === z);
                        const selected = layer?.cells.some((p) => p.x === x && p.y === y);
                        return (
                          <button
                            key={`${x}-${y}`}
                            className={`grid-anchor ${selected ? 'selected' : ''}`}
                            style={{ left: x * 32, top: y * 32 }}
                            aria-label={`格子 ${x},${y}`}
                            title={`列 ${x / 2 + 1}，行 ${y / 2 + 1}`}
                            onClick={() => {
                              if (!layer) return;
                              if (
                                !selected &&
                                layer.cells.some(
                                  (p) => Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2,
                                )
                              ) {
                                message.warning('同层方块不能重叠');
                                return;
                              }
                              update((c) => {
                                const l = c.layers.find((v) => v.z === z)!;
                                l.cells = selected
                                  ? l.cells.filter((p) => p.x !== x || p.y !== y)
                                  : [...l.cells, { x, y }];
                              });
                            }}
                          >
                            {selected ? z + 1 : '·'}
                          </button>
                        );
                      }),
                    )}
                  </div>
                </div>
                <Space wrap className="editor-actions">
                  <Button
                    onClick={() =>
                      update((c) => {
                        const l = c.layers.find((v) => v.z === z)!;
                        l.cells = [];
                        for (let y = 0; y < c.rows * 2; y += 2)
                          for (let x = 0; x < c.columns * 2; x += 2) l.cells.push({ x, y });
                      })
                    }
                  >
                    填满本层
                  </Button>
                  <Button
                    onClick={() =>
                      update((c) => {
                        c.layers.find((v) => v.z === z)!.cells = [];
                      })
                    }
                  >
                    清空本层
                  </Button>
                  <Button
                    disabled={editing.config.layers.length === 1}
                    danger
                    onClick={() => {
                      const next = editing.config.layers.filter((l) => l.z !== z);
                      update((c) => {
                        c.layers = next;
                      });
                      setZ(next[0].z);
                    }}
                  >
                    删除本层
                  </Button>
                </Space>
                <Alert
                  type={total === counts ? 'success' : 'warning'}
                  showIcon
                  title={`格子 ${total} 个 · 萌宠 ${counts} 块 · ${editing.config.counts.filter((n) => n > 0).length} 种`}
                  description="发布时总数必须相等；三消每种数量为 3 的倍数，四消为 4 的倍数。趣味消会校验三同或两对的组合。"
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
                  重复通关保留记录，每关仅首次通关获得奖励。免费次数用完后消耗玩家背包。
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
