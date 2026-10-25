export const passwordRule = {
  validator: async (_: unknown, value: string | undefined) => {
    if (!value) return;
    const length = new TextEncoder().encode(value).length;
    if (length < 10 || length > 72)
      throw new Error('密码需为 10–72 个 UTF-8 字节（汉字通常占 3 字节）');
  },
};

export const formatAccountDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '—';
