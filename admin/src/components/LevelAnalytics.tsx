import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { errorMessage } from '../api';
import { date, entryNames, modeNames, toolNames, type Level } from '../game-api';
import {
  analyticsPercent,
  levelAnalytics,
  type AnalyticsRange,
  type AnalyticsRevision,
  type LevelAnalytics as Analytics,
} from '../level-analytics-api';
import LevelAnalyticsTrend from './LevelAnalyticsTrend';
import './level-analytics.css';

type Result =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: Analytics };
const count = (value: number) => value.toLocaleString('zh-CN');
const duration = (seconds: number | null) => {
  if (seconds === null) return '—';
  const total = Math.round(seconds);
  return total < 60
    ? `${total}秒`
    : total < 3600
      ? `${Math.floor(total / 60)}分${total % 60}秒`
      : `${Math.floor(total / 3600)}时${Math.floor((total % 3600) / 60)}分`;
};
function Metric({
  title,
  value,
  note,
  primary = false,
}: {
  title: string;
  value: string;
  note: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`analytics-metric${primary ? ' analytics-metric-primary' : ''}`}
      aria-label={title}
    >
      <span className="analytics-metric-title">{title}</span>
      <strong>{value}</strong>
      <span className="analytics-metric-note">{note}</span>
    </div>
  );
}
export default function LevelAnalytics({ level, onClose }: { level: Level; onClose(): void }) {
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [revisionId, setRevisionId] = useState('');
  const [reload, setReload] = useState(0);
  const [revisions, setRevisions] = useState<AnalyticsRevision[]>([]);
  const [result, setResult] = useState<Result>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    levelAnalytics(level.id, range, revisionId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRevisions(data.revisions);
          setResult({ status: 'ready', data });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ status: 'error', message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [level.id, range, revisionId, reload]);
  const refresh = () => {
    setResult({ status: 'loading' });
    setReload((n) => n + 1);
  };
  const data = result.status === 'ready' ? result.data : null;
  const summary = data?.summary;
  const outcomes = summary
    ? [
        { key: 'won', label: '通关', value: summary.won },
        { key: 'lost', label: '失败', value: summary.lost },
        { key: 'abandoned', label: '主动退出', value: summary.abandoned },
        { key: 'unfinished', label: '未结束', value: summary.unfinished },
      ]
    : [];
  return (
    <Drawer
      title="关卡数据分析"
      open
      onClose={onClose}
      size={1040}
      styles={{ wrapper: { maxWidth: '100vw' } }}
      className="analytics-drawer"
      closable={false}
      extra={
        <Button aria-label="关闭分析" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="analytics-heading">
        <div>
          <Space size={6} wrap>
            <Tag>{entryNames[level.entry]}</Tag>
            <Tag>{modeNames[level.mode]}</Tag>
            <span className="analytics-ordinal">第 {level.ordinal} 关</span>
          </Space>
          <Typography.Title level={3}>{level.title}</Typography.Title>
          <Typography.Text type="secondary">用真实对局观察关卡表现</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={refresh} disabled={result.status === 'loading'}>
          刷新数据
        </Button>
      </div>
      <div className="analytics-filters">
        <Segmented
          aria-label="统计时间"
          value={range}
          options={[
            { label: '近7天', value: '7d' },
            { label: '近30天', value: '30d' },
            { label: '近90天', value: '90d' },
            { label: '全部', value: 'all' },
          ]}
          onChange={(value) => {
            setResult({ status: 'loading' });
            setRange(value as AnalyticsRange);
          }}
        />
        <Select
          aria-label="发布版本"
          value={revisionId}
          onChange={(value) => {
            setResult({ status: 'loading' });
            setRevisionId(value);
          }}
          options={[
            { label: '全部发布版本', value: '' },
            ...revisions.map((r) => ({
              value: r.id,
              label: `v${r.version} · ${r.current ? '当前发布' : '历史版本'}`,
            })),
          ]}
        />
      </div>
      {result.status === 'loading' ? (
        <div className="analytics-loading" role="status">
          <Spin />
          <span>正在汇总对局数据…</span>
        </div>
      ) : null}
      {result.status === 'error' ? (
        <Alert
          type="error"
          showIcon
          title="数据加载失败"
          description={result.message}
          action={
            <Button aria-label="重试" onClick={refresh}>
              重试
            </Button>
          }
        />
      ) : null}
      {data && summary ? (
        <>
          <div className="analytics-metrics">
            <Metric
              title="通过率"
              value={analyticsPercent(summary.winRate)}
              note="通关次数 ÷ 开局次数"
              primary
            />
            <Metric
              title="开局次数"
              value={count(summary.attempts)}
              note={`已结束对局通过率 ${analyticsPercent(summary.finishedWinRate)}`}
            />
            <Metric title="参与人数" value={count(summary.players)} note="所选范围内去重玩家" />
            <Metric title="通关次数" value={count(summary.won)} note="重复通关也计为一次对局" />
            <Metric
              title="平均通关耗时"
              value={duration(summary.avgWinDurationSeconds)}
              note={`${count(summary.winDurationSamples)} 局有效耗时 · 含停留时间`}
            />
            <Metric
              title="平均通关步数"
              value={summary.avgWinMoves === null ? '—' : summary.avgWinMoves.toFixed(1)}
              note="仅计点选步数，撤回会回退"
            />
          </div>
          {summary.attempts === 0 ? (
            <div className="analytics-empty">
              <Empty description="暂无对局数据" />
              <Typography.Text type="secondary">
                此关卡在所选时间和版本下，还没有已上传的对局记录。
              </Typography.Text>
            </div>
          ) : (
            <>
              <section className="analytics-panel" aria-label="对局结果分布">
                <div className="analytics-section-heading">
                  <Typography.Title level={5}>对局结果</Typography.Title>
                  <Typography.Text type="secondary">
                    共 {count(summary.attempts)} 局
                  </Typography.Text>
                </div>
                <div className="analytics-outcome-bar" aria-hidden="true">
                  {outcomes
                    .filter((v) => v.value > 0)
                    .map((v) => (
                      <span
                        key={v.key}
                        className={`analytics-outcome-${v.key}`}
                        style={{ width: `${(v.value / summary.attempts) * 100}%` }}
                      />
                    ))}
                </div>
                <div className="analytics-outcomes">
                  {outcomes.map((v) => (
                    <div key={v.key}>
                      <span>
                        <i className={`analytics-outcome-${v.key}`} />
                        {v.label}
                      </span>
                      <strong>
                        {count(v.value)} <small>局</small>
                      </strong>
                      <span>{analyticsPercent((v.value / summary.attempts) * 100)}</span>
                    </div>
                  ))}
                </div>
              </section>
              <LevelAnalyticsTrend
                key={`${range}-${revisionId}-${reload}`}
                days={data.daily}
                allHistory={range === 'all'}
              />
            </>
          )}
          <section className="analytics-panel" aria-label="道具使用情况">
            <div className="analytics-section-heading">
              <Typography.Title level={5}>道具与额外槽位</Typography.Title>
              <Typography.Text type="secondary">统计已验证操作，包含免费与背包道具</Typography.Text>
            </div>
            <Table
              rowKey="type"
              size="small"
              pagination={false}
              dataSource={data.tools}
              columns={[
                {
                  title: '操作',
                  dataIndex: 'type',
                  render: (type: string) =>
                    type === 'unlock_slot' ? '额外槽位解锁' : toolNames[type],
                },
                { title: '使用次数', dataIndex: 'uses', align: 'right', render: count },
                { title: '使用对局数', dataIndex: 'sessions', align: 'right', render: count },
              ]}
            />
          </section>
          <div className="analytics-definitions">
            <strong>统计口径</strong>
            <p>
              通过率按开局次数计算；已结束对局通过率的分母为通关、失败和主动退出的对局总数。未结束不等于失败，可能包含中断或未上报结果的对局。
            </p>
            <p>
              按北京时间的开局日期筛选。耗时取服务端开局至结算的时长，包含切后台和停留。仅统计已同步到服务端的对局，离线练习不计入。
              {range === 'all' ? '汇总覆盖全部历史，每日趋势仅展示最近90天。' : ''}
            </p>
            <span>更新于 {date(data.generatedAt)}</span>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
