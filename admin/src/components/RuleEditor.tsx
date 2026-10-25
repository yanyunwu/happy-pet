import { useState } from 'react';
import { Alert, Input, Radio, Typography } from 'antd';

type RuleChoice = '3' | '4' | '2+2' | 'other';
const presets: Record<Exclude<RuleChoice, 'other'>, number[]> = {
  '3': [3],
  '4': [4],
  '2+2': [2, 2],
};

export function ruleIssue(rules: number[][]): string {
  if (rules.length !== 1) return '每关只能选择一种消除规则，请重新选择';
  const pattern = rules[0];
  const total = pattern.reduce((sum, n) => sum + n, 0);
  if (
    !pattern.length ||
    pattern.some((n) => !Number.isInteger(n) || n < 1 || n > 7) ||
    total < 2 ||
    total > 7
  )
    return '使用正整数和加号，合计 2–7 个萌宠，例如 3+2 或 2+2+2';
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
  // Keep partial Other input until the controlled value changes. In particular,
  // typing the first "3" in "3+2" must not switch away from Other.
  const [draft, setDraft] = useState<{
    key: string;
    choice: RuleChoice;
    text: string;
  } | null>(null);
  const key = JSON.stringify(value);
  if (draft && draft.key !== key) setDraft(null);
  const current = draft?.key === key ? draft : null;
  const pattern = value.length === 1 ? value[0].join('+') : '';
  const preset = Object.hasOwn(presets, pattern) ? (pattern as Exclude<RuleChoice, 'other'>) : null;
  const selected = current?.choice ?? (value.length === 1 ? preset || 'other' : undefined);
  const text = current?.text ?? pattern;
  const change = (choice: RuleChoice, nextText: string) => {
    const rules = [
      choice === 'other'
        ? nextText
            .replaceAll('＋', '+')
            .split('+')
            .map((part) => (/^\d+$/.test(part.trim()) ? Number(part.trim()) : 0))
        : presets[choice].slice(),
    ];
    setDraft({ key: JSON.stringify(rules), choice, text: nextText });
    onChange(rules);
  };
  const issue = ruleIssue(value);
  return (
    <fieldset disabled={disabled} className="rule-editor">
      <Typography.Title level={5}>消除规则</Typography.Title>
      <Typography.Paragraph type="secondary">
        每关只能选择一种组合。数字表示同种萌宠数量，加号两侧是不同种类。
      </Typography.Paragraph>
      <Radio.Group
        aria-label="消除规则"
        name="level-elimination-rule"
        optionType="button"
        buttonStyle="solid"
        value={selected}
        disabled={disabled}
        onChange={(event) => change(event.target.value as RuleChoice, '')}
        options={[
          { label: '3', value: '3' },
          { label: '4', value: '4' },
          { label: '2+2', value: '2+2' },
          { label: '其他', value: 'other' },
        ]}
      />
      {selected === 'other' && (
        <Input
          className="rule-custom-input"
          aria-label="其他消除组合"
          value={text}
          disabled={disabled}
          status={issue ? 'error' : undefined}
          placeholder="例如 3+2 或 2+2+2"
          maxLength={32}
          onChange={(event) => change('other', event.target.value)}
        />
      )}
      <Typography.Paragraph className="rule-help" type="secondary">
        3 = 三个相同 · 4 = 四个相同 · 2+2 = 两种各两个。其他可填 3+2、2+2+2 等单个组合，合计 2–7
        个。所属入口只决定首页按钮，不会改变这里选择的规则。
      </Typography.Paragraph>
      {issue && (
        <Alert
          type="error"
          showIcon
          title={issue}
          description={
            value.length > 1
              ? `当前配置：${value.map((item) => item.join('+')).join(' / ')}`
              : undefined
          }
        />
      )}
    </fieldset>
  );
}
