import { useEffect, useRef, useState } from 'react';
import { Segmented, Table, Typography } from 'antd';
import { analyticsPercent, type AnalyticsDay } from '../level-analytics-api';

export default function LevelAnalyticsTrend({
  days,
  allHistory,
}: {
  days: AnalyticsDay[];
  allHistory: boolean;
}) {
  const [view, setView] = useState('趋势图');
  const [selected, setSelected] = useState<number | null>(null);
  const chart = useRef<SVGSVGElement>(null);
  const [w, setWidth] = useState(840);
  useEffect(() => {
    if (!chart.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(chart.current);
    return () => observer.disconnect();
  }, [view]);
  const h = 214,
    left = 40,
    right = 40,
    top = 20,
    bottom = 32;
  const plotW = w - left - right,
    plotH = h - top - bottom;
  const max = Math.max(1, ...days.map((d) => d.attempts));
  const step = plotW / Math.max(days.length, 1);
  const x = (i: number) => left + step * (i + 0.5);
  const y = (rate: number) => top + plotH * (1 - rate / 100);
  let line = '';
  let connected = false;
  for (let i = 0; i < days.length; i++) {
    const rate = days[i].winRate;
    if (rate === null) {
      connected = false;
      continue;
    }
    line += `${connected ? 'L' : 'M'}${x(i).toFixed(2)},${y(rate).toFixed(2)} `;
    connected = true;
  }
  const focused = selected === null ? undefined : days[selected];
  return (
    <section className="analytics-panel" aria-label="每日趋势">
      <div className="analytics-section-heading">
        <div>
          <Typography.Title level={5}>{allHistory ? '最近90天趋势' : '每日趋势'}</Typography.Title>
          <Typography.Text type="secondary">按开局日期归属 · 北京时间</Typography.Text>
        </div>
        <Segmented
          aria-label="趋势展示方式"
          value={view}
          onChange={setView}
          options={['趋势图', '每日明细']}
        />
      </div>
      {view === '每日明细' ? (
        <Table
          size="small"
          rowKey="date"
          dataSource={[...days].reverse()}
          pagination={{ pageSize: 7, showSizeChanger: false }}
          scroll={{ x: 630 }}
          columns={[
            { title: '日期', dataIndex: 'date' },
            { title: '开局', dataIndex: 'attempts' },
            { title: '通关', dataIndex: 'won' },
            { title: '失败', dataIndex: 'lost' },
            { title: '主动退出', dataIndex: 'abandoned' },
            { title: '未结束', dataIndex: 'unfinished' },
            { title: '通过率', dataIndex: 'winRate', render: analyticsPercent },
          ]}
        />
      ) : (
        <>
          <div className="analytics-chart-legend">
            <span>
              <i className="analytics-bar-key" />
              开局次数（左轴）
            </span>
            <span>
              <i className="analytics-line-key" />
              通过率（右轴）
            </span>
          </div>
          <svg
            ref={chart}
            className="analytics-chart"
            viewBox={`0 0 ${w} ${h}`}
            role="img"
            aria-label="每日开局次数与通过率趋势图"
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={left}
                  x2={w - right}
                  y1={top + plotH * f}
                  y2={top + plotH * f}
                  className="analytics-grid-line"
                />
                <text x={left - 9} y={top + plotH * f + 4} textAnchor="end">
                  {Number((max * (1 - f)).toFixed(1))}
                </text>
                <text x={w - right + 9} y={top + plotH * f + 4}>
                  {Math.round(100 * (1 - f))}%
                </text>
              </g>
            ))}
            {days.map((d, i) => (
              <rect
                key={d.date}
                x={x(i) - step * 0.32}
                y={top + plotH * (1 - d.attempts / max)}
                width={step * 0.64}
                height={(plotH * d.attempts) / max}
                rx={2}
                className="analytics-chart-bar"
              />
            ))}
            <path d={line} className="analytics-chart-line" />
            {days.map((d, i) => (
              <g key={d.date}>
                {d.winRate !== null ? (
                  <circle cx={x(i)} cy={y(d.winRate)} r={3} className="analytics-chart-dot" />
                ) : null}
                <rect
                  x={left + i * step}
                  y={top}
                  width={step}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.date}，开局${d.attempts}次，通过率${analyticsPercent(d.winRate)}`}
                  onFocus={() => setSelected(i)}
                  onBlur={() => setSelected(null)}
                  onMouseEnter={() => setSelected(i)}
                  onMouseLeave={() => setSelected(null)}
                  onClick={() => setSelected(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(i);
                    }
                  }}
                />
                {i === 0 || i === days.length - 1 || i === Math.floor(days.length / 2) ? (
                  <text
                    x={x(i)}
                    y={h - 8}
                    textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}
                  >
                    {d.date.slice(5)}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
          <div className="analytics-chart-detail" aria-live="polite">
            {focused
              ? `${focused.date} · 开局 ${focused.attempts} 次 · 通关 ${focused.won} 次 · 通过率 ${analyticsPercent(focused.winRate)}`
              : '悬停、点击或用键盘选中日期查看详情；无开局日期不绘制通过率。'}
          </div>
        </>
      )}
    </section>
  );
}
