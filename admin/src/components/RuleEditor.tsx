import { useState } from 'react';
import { Alert, Button, Input, Space, Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined } from '@ant-design/icons';

export function ruleIssue(rules: number[][]): string {
  if (!rules.length || rules.length > 6) return '请设置 1–6 条消除规则';
  const seen = new Set<string>();
  for (const pattern of rules) {
    const total = pattern.reduce((sum, n) => sum + n, 0);
    if (
      !pattern.length ||
      pattern.some((n) => !Number.isInteger(n) || n < 1 || n > 7) ||
      total < 2 ||
      total > 7
    )
      return '使用正整数和加号，每条合计 2–7 个萌宠，例如 3 或 3+2';
    const key = pattern
      .slice()
      .sort((a, b) => b - a)
      .join('+');
    if (seen.has(key)) return '同一条组合不能重复添加';
    seen.add(key);
  }
  return '';
}

export default function RuleEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: number[][];
  onChange: (rules: number[][]) => void;
  disabled?: boolean;
}) {
  const [texts, setTexts] = useState(() => value.map((pattern) => pattern.join('+')));
  const change = (next: string[]) => {
    setTexts(next);
    onChange(
      next.map((text) =>
        text
          .replaceAll('＋', '+')
          .split('+')
          .map((part) => (/^\d+$/.test(part.trim()) ? Number(part.trim()) : 0)),
      ),
    );
  };
  const issue = ruleIssue(value);
  const canonical = value.map((pattern) => pattern.slice().sort((a, b) => b - a));
  const covered = issue
    ? []
    : canonical.flatMap((pattern, i) =>
        canonical.some(
          (other, j) =>
            i !== j &&
            (j < i || (other.length === 1 && pattern.length === 1)) &&
            other.length <= pattern.length &&
            other.every((n, k) => n <= pattern[k]),
        )
          ? [i + 1]
          : [],
      );
  return (
    <fieldset disabled={disabled} className="rule-editor">
      <Typography.Title level={5}>自定义消除规则</Typography.Title>
      <Typography.Paragraph type="secondary">
        数字表示同种萌宠数量，加号两侧是不同种类。可以同时启用多条，按从上到下的顺序优先匹配。
      </Typography.Paragraph>
      {texts.map((text, index) => (
        <div className="rule-row" key={index}>
          <span className="rule-priority">{index + 1}</span>
          <Input
            aria-label={`消除规则 ${index + 1}`}
            value={text}
            disabled={disabled}
            placeholder="例如 3+2"
            maxLength={32}
            onChange={(event) =>
              change(texts.map((item, i) => (i === index ? event.target.value : item)))
            }
          />
          <Space size={0}>
            <Button
              type="text"
              aria-label={`上移规则 ${index + 1}`}
              icon={<ArrowUpOutlined />}
              disabled={disabled || index === 0}
              onClick={() => {
                const next = texts.slice();
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                change(next);
              }}
            />
            <Button
              type="text"
              aria-label={`下移规则 ${index + 1}`}
              icon={<ArrowDownOutlined />}
              disabled={disabled || index === texts.length - 1}
              onClick={() => {
                const next = texts.slice();
                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                change(next);
              }}
            />
            <Button
              type="text"
              danger
              aria-label={`删除规则 ${index + 1}`}
              icon={<DeleteOutlined />}
              disabled={disabled || texts.length === 1}
              onClick={() => change(texts.filter((_, i) => i !== index))}
            />
          </Space>
        </div>
      ))}
      <Button disabled={disabled || texts.length >= 6} onClick={() => change([...texts, '2+2'])}>
        添加规则
      </Button>
      <Typography.Paragraph className="rule-help" type="secondary">
        3 = 三个相同 · 4 = 四个相同 · 2+2 = 两种各两个 · 3+2 = 一种三个、另一种两个。收纳槽为 7
        格，每条合计不能超过 7。
      </Typography.Paragraph>
      {issue ? (
        <Alert type="error" showIcon title={issue} />
      ) : covered.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`第 ${covered.join('、')} 条无法触发：较小的组合会提前或优先消除。`}
        />
      ) : null}
    </fieldset>
  );
}
