import { useState } from 'react';
import { App, Button, InputNumber, Select, Space, Typography } from 'antd';
import type { BoardLayout } from '../game-api';

const layerColors = [
  '#c7dbbf',
  '#a9c4a2',
  '#85ad82',
  '#659566',
  '#4a7c52',
  '#3d6947',
  '#31573d',
  '#234832',
];

export function LayoutPreview({ layout }: { layout: BoardLayout }) {
  return (
    <svg
      className="layout-preview"
      viewBox={`-3 -3 ${layout.columns * 24 + 6} ${layout.rows * 24 + 8}`}
      role="img"
      aria-label="棋盘布局预览"
    >
      {layout.layers
        .slice()
        .sort((a, b) => a.z - b.z)
        .flatMap((layer) =>
          layer.cells.map((cell, i) => (
            <g key={`${layer.z}-${i}`}>
              <rect
                x={cell.x * 12}
                y={cell.y * 12 + 2}
                width="22"
                height="22"
                rx="4"
                fill="#244d3466"
              />
              <rect
                x={cell.x * 12}
                y={cell.y * 12}
                width="22"
                height="22"
                rx="4"
                fill={layerColors[layer.z]}
                stroke="#f6f9f0"
                strokeWidth="0.8"
              />
            </g>
          )),
        )}
    </svg>
  );
}

/** Shared geometry editor. It cannot access pet counts, rules, tools or rewards. */
export default function LayoutEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: BoardLayout;
  onChange: (layout: BoardLayout) => void;
  disabled?: boolean;
}) {
  const { message, modal } = App.useApp();
  const [selectedLayer, setSelectedLayer] = useState(value.layers[0]?.z ?? 0);
  const z = value.layers.some((layer) => layer.z === selectedLayer)
    ? selectedLayer
    : (value.layers[0]?.z ?? 0);
  const layer = value.layers.find((item) => item.z === z);
  const change = (action: (layout: BoardLayout) => void) => {
    if (disabled) return;
    const next = structuredClone(value);
    action(next);
    onChange(next);
  };
  const resize = (field: 'columns' | 'rows', amount: number | null) => {
    if (disabled || amount === null || amount === value[field]) return;
    const next = structuredClone(value);
    next[field] = amount;
    const before = next.layers.reduce((n, item) => n + item.cells.length, 0);
    next.layers = next.layers.map((item) => ({
      ...item,
      cells: item.cells.filter(
        (cell) => cell.x <= (next.columns - 1) * 2 && cell.y <= (next.rows - 1) * 2,
      ),
    }));
    const removed = before - next.layers.reduce((n, item) => n + item.cells.length, 0);
    if (removed)
      modal.confirm({
        title: '缩小棋盘？',
        content: `将移除超出边界的 ${removed} 个格子。萌宠配比需要另行调整。`,
        okText: '调整棋盘',
        cancelText: '取消',
        onOk: () => onChange(next),
      });
    else onChange(next);
  };
  return (
    <fieldset className="layout-editor" disabled={disabled}>
      <Space wrap>
        <label>
          列{' '}
          <InputNumber
            aria-label="棋盘列数"
            disabled={disabled}
            min={1}
            max={6}
            precision={0}
            value={value.columns}
            onChange={(n) => resize('columns', n)}
          />
        </label>
        <label>
          行{' '}
          <InputNumber
            aria-label="棋盘行数"
            disabled={disabled}
            min={1}
            max={8}
            precision={0}
            value={value.rows}
            onChange={(n) => resize('rows', n)}
          />
        </label>
        <Select
          disabled={disabled}
          aria-label="编辑层"
          value={z}
          onChange={setSelectedLayer}
          options={value.layers.map((item) => ({
            value: item.z,
            label: `第 ${item.z + 1} 层 · ${item.cells.length} 块`,
          }))}
        />
        <Button
          disabled={value.layers.length >= 8}
          onClick={() => {
            const nextZ = Array.from({ length: 8 }, (_, i) => i).find(
              (n) => !value.layers.some((item) => item.z === n),
            )!;
            change((next) => next.layers.push({ z: nextZ, cells: [] }));
            setSelectedLayer(nextZ);
          }}
        >
          添加一层
        </Button>
      </Space>
      <Typography.Paragraph type="secondary" className="grid-caption">
        点击放置或移除方块。圆点间距为半格，可做错位叠层；同层不可重叠，高层覆盖低层。
      </Typography.Paragraph>
      <div className="grid-editor-scroll">
        <div className="grid-editor" style={{ width: value.columns * 64, height: value.rows * 64 }}>
          {value.layers
            .filter((item) => item.z < z)
            .map((item) =>
              item.cells.map((cell, i) => (
                <div
                  className="grid-under"
                  key={`${item.z}-${i}`}
                  style={{ left: cell.x * 32, top: cell.y * 32 }}
                >
                  {item.z + 1}
                </div>
              )),
            )}
          {Array.from({ length: value.rows * 2 - 1 }, (_, y) =>
            Array.from({ length: value.columns * 2 - 1 }, (_, x) => {
              const selected = layer?.cells.some((cell) => cell.x === x && cell.y === y);
              return (
                <button
                  key={`${x}-${y}`}
                  className={`grid-anchor ${selected ? 'selected' : ''}`}
                  style={{ left: x * 32, top: y * 32 }}
                  aria-label={`格子 ${x},${y}`}
                  aria-pressed={!!selected}
                  title={`列 ${x / 2 + 1}，行 ${y / 2 + 1}`}
                  onClick={() => {
                    if (!layer) return;
                    if (
                      !selected &&
                      layer.cells.some(
                        (cell) => Math.abs(cell.x - x) < 2 && Math.abs(cell.y - y) < 2,
                      )
                    ) {
                      message.warning('同层方块不能重叠');
                      return;
                    }
                    change((next) => {
                      const target = next.layers.find((item) => item.z === z)!;
                      target.cells = selected
                        ? target.cells.filter((cell) => cell.x !== x || cell.y !== y)
                        : [...target.cells, { x, y }];
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
            change((next) => {
              const target = next.layers.find((item) => item.z === z)!;
              target.cells = [];
              for (let y = 0; y < next.rows * 2; y += 2)
                for (let x = 0; x < next.columns * 2; x += 2) target.cells.push({ x, y });
            })
          }
        >
          填满本层
        </Button>
        <Button
          onClick={() =>
            change((next) => {
              next.layers.find((item) => item.z === z)!.cells = [];
            })
          }
        >
          清空本层
        </Button>
        <Button
          danger
          disabled={value.layers.length === 1}
          onClick={() =>
            change((next) => {
              next.layers = next.layers.filter((item) => item.z !== z);
            })
          }
        >
          删除本层
        </Button>
      </Space>
    </fieldset>
  );
}
