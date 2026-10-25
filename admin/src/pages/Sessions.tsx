import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Select,
  Slider,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api';
import {
  gameApi,
  entryNames,
  modeNames,
  toolNames,
  date,
  petNames,
  type Replay,
  type Session,
} from '../game-api';
import Board from '../components/Board';
const statuses: Record<string, string> = {
  playing: '进行中',
  won: '通关',
  lost: '失败',
  abandoned: '中途退出',
};
export default function Sessions() {
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const [query, setQueryState] = useState({
    userId: params.get('userId') || '',
    mode: '',
    entry: '',
    status: '',
    page: 1,
    pageSize: 20,
  });
  const [items, setItems] = useState<Session[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [replay, setReplay] = useState<Replay | null>(null),
    [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [opening, setOpening] = useState('');
  const setQuery = (value: typeof query) => {
    setLoading(true);
    setQueryState(value);
  };
  useEffect(() => {
    let active = true;
    gameApi
      .sessions(query)
      .then((v) => {
        if (active) {
          setItems(v.items);
          setTotal(v.total);
        }
      })
      .catch((e) => message.error(errorMessage(e)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, revision, message]);
  useEffect(() => {
    if (!playing || !replay) return;
    if (step >= replay.events.length) return;
    const previous = step ? replay.events[step - 1].action.at : 0;
    const delay = Math.min(3000, Math.max(120, (replay.events[step].action.at - previous) / speed));
    const timer = setTimeout(() => setStep((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [playing, replay, step, speed]);
  const isPlaying = playing && !!replay && step < replay.events.length;
  const state = replay ? (step ? replay.events[step - 1].state : replay.initial) : null;
  const action = replay && step ? replay.events[step - 1].action : null;
  const open = async (id: string) => {
    setOpening(id);
    try {
      setReplay(await gameApi.replay(id));
      setStep(0);
      setPlaying(false);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setOpening('');
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>对局记录</Typography.Title>
          <Typography.Text type="secondary">
            查看通关、失败及退出过程，按实际棋盘逐步回放。
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => setRevision((v) => v + 1)}>
          刷新
        </Button>
      </div>
      <Card className="users-card" styles={{ body: { padding: 0 } }}>
        <div className="table-toolbar">
          <Input.Search
            placeholder="按用户 ID 筛选"
            defaultValue={query.userId}
            allowClear
            onSearch={(userId) => setQuery({ ...query, userId, page: 1 })}
            style={{ width: 300 }}
          />
          <Select
            aria-label="对局模式"
            value={query.mode}
            onChange={(mode) => setQuery({ ...query, mode, page: 1 })}
            style={{ width: 180 }}
            options={[
              { value: '', label: '全部模式' },
              ...Object.entries(modeNames).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Select
            aria-label="玩法入口"
            value={query.entry}
            onChange={(entry) => setQuery({ ...query, entry, page: 1 })}
            style={{ width: 150 }}
            options={[
              { value: '', label: '全部入口' },
              ...Object.entries(entryNames).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Select
            aria-label="对局结果"
            value={query.status}
            onChange={(status) => setQuery({ ...query, status, page: 1 })}
            style={{ width: 150 }}
            options={[
              { value: '', label: '全部结果' },
              ...Object.entries(statuses).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
        <Table<Session>
          rowKey="id"
          dataSource={items}
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total,
            showSizeChanger: true,
            onChange: (page, pageSize) => setQuery({ ...query, page, pageSize }),
          }}
          columns={[
            {
              title: '玩家',
              dataIndex: 'nickname',
              render: (v, record) => (
                <>
                  <strong>{v}</strong>
                  <div className="table-secondary">{record.userId.slice(0, 10)}…</div>
                </>
              ),
            },
            {
              title: '关卡',
              render: (_, r) => (
                <>
                  {modeNames[r.mode]}
                  <Tag style={{ marginInlineStart: 8 }}>{entryNames[r.entry]}</Tag>
                  <div className="table-secondary">
                    第 {r.ordinal} 关 · {r.title}
                  </div>
                </>
              ),
            },
            {
              title: '结果',
              render: (_, r) => (
                <>
                  <Tag
                    color={r.status === 'won' ? 'green' : r.status === 'lost' ? 'red' : 'default'}
                  >
                    {statuses[r.status]}
                  </Tag>
                  {!r.settled && r.status !== 'playing' && (
                    <div className="table-secondary">待结算</div>
                  )}
                </>
              ),
            },
            { title: '消除进度', render: (_, r) => `${r.cleared} / ${r.total}` },
            { title: '操作数', dataIndex: 'steps' },
            { title: '奖励金币', dataIndex: 'rewardCoins' },
            { title: '开始时间', dataIndex: 'startedAt', render: date },
            {
              title: '操作',
              fixed: 'right',
              render: (_, r) => (
                <Button
                  type="link"
                  icon={<PlayCircleOutlined />}
                  loading={opening === r.id}
                  onClick={() => void open(r.id)}
                >
                  回放
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        title="对局回放"
        size={1040}
        open={!!replay}
        onClose={() => {
          setPlaying(false);
          setReplay(null);
        }}
      >
        {replay && state && (
          <>
            <div className="replay-layout">
              <div>
                <Board
                  state={state}
                  highlight={action?.type === 'pick' ? action.tileId : undefined}
                />
              </div>
              <div>
                <Typography.Title level={4}>
                  {modeNames[state.mode]} · 第 {replay.session.ordinal} 关
                </Typography.Title>
                <Tag color={replay.status === 'won' ? 'green' : 'default'}>
                  {statuses[replay.status]}
                </Tag>
                <Typography.Paragraph type="secondary">{replay.session.title}</Typography.Paragraph>
                <Tag>{entryNames[replay.session.entry]}</Tag>
                <Descriptions
                  column={1}
                  size="small"
                  items={[
                    { key: 'id', label: '对局编号', children: replay.session.id },
                    { key: 'user', label: '用户', children: replay.userId },
                    { key: 'version', label: '关卡版本', children: replay.session.revisionId },
                    { key: 'seed', label: '随机种子', children: replay.session.seed },
                    { key: 'time', label: '开始时间', children: date(replay.startedAt) },
                    {
                      key: 'moves',
                      label: '当前进度',
                      children: `消除 ${state.cleared}/${state.tiles.length} · ${state.moves} 次选择`,
                    },
                  ]}
                />
                <Typography.Title level={5}>
                  第 {step} / {replay.events.length} 步
                </Typography.Title>
                <Typography.Paragraph>
                  {!action
                    ? '初始棋盘'
                    : action.type === 'pick'
                      ? `收集 ${petNames[state.tiles[action.tileId ?? 0].kind]} · 方块 ${action.tileId ?? 0}`
                      : toolNames[action.type] || action.type}
                </Typography.Paragraph>
                <Space wrap>
                  <Button
                    type="primary"
                    icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                    disabled={!replay.events.length}
                    onClick={() => {
                      if (step === replay.events.length) setStep(0);
                      setPlaying(!isPlaying);
                    }}
                  >
                    {isPlaying ? '暂停' : '播放'}
                  </Button>
                  <Button
                    disabled={!step}
                    onClick={() => {
                      setPlaying(false);
                      setStep((n) => n - 1);
                    }}
                  >
                    上一步
                  </Button>
                  <Button
                    disabled={step === replay.events.length}
                    onClick={() => {
                      setPlaying(false);
                      setStep((n) => n + 1);
                    }}
                  >
                    下一步
                  </Button>
                  <Select
                    value={speed}
                    onChange={setSpeed}
                    options={[0.5, 1, 2, 4].map((v) => ({ value: v, label: `${v} 倍速` }))}
                  />
                </Space>
                <Slider
                  aria-label="回放进度"
                  min={0}
                  max={Math.max(1, replay.events.length)}
                  value={step}
                  onChange={(v) => {
                    setPlaying(false);
                    setStep(v);
                  }}
                />
                <Typography.Paragraph type="secondary">
                  播放采用操作时间间隔，长停顿压缩到 3
                  秒。拖动进度条查看任意一步的棋盘、收纳槽与暂存区。
                </Typography.Paragraph>
                <Alert
                  type="info"
                  showIcon
                  title="使用当局版本和服务端校验后的棋盘快照回放"
                  description="重排、撤回、铲出均保存实际结果；后续修改关卡不会改变历史回放。"
                />
                <div className="replay-tools">
                  {Object.entries(toolNames).map(([id, name]) => (
                    <Tag key={id}>
                      {name}免费 {state.tools[id]}
                    </Tag>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}
