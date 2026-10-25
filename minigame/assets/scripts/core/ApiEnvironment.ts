export type ApiEnvironment = 'local' | 'preview' | 'production';

export interface WechatEnvironmentAPI {
  getDeviceInfo?: () => { platform?: string };
  getSystemInfoSync?: () => { platform?: string };
  getAccountInfoSync?: () => { miniProgram?: { envVersion?: string } };
}

/** Native WeChat metadata, never a query-string or local-storage override. */
export function detectApiEnvironment(runtime?: WechatEnvironmentAPI | null): ApiEnvironment {
  if (!runtime) return 'local';
  let platform = '';
  try {
    platform = runtime.getDeviceInfo?.()?.platform || '';
  } catch {
    /* Older SDK. */
  }
  if (!platform) {
    try {
      platform = runtime.getSystemInfoSync?.()?.platform || '';
    } catch {
      /* Use account information below. */
    }
  }
  if (platform === 'devtools') return 'local';
  try {
    const version = runtime.getAccountInfoSync?.()?.miniProgram?.envVersion;
    if (version === 'develop' || version === 'trial') return 'preview';
  } catch {
    /* Unidentified native builds use production. */
  }
  return 'production';
}

function ipv4Parts(host: string): number[] | null {
  const parts = host.split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)
  )
    return null;
  return parts.map(Number);
}

function normalizeHost(value: string): { host: string; loopback: boolean } {
  const invalid = () => new Error('接口域名或 IP 地址格式无效');
  if (value.startsWith('[')) {
    let raw = value.slice(1, -1).toLowerCase();
    if (raw.includes('.')) {
      const split = raw.lastIndexOf(':'),
        ipv4 = ipv4Parts(raw.slice(split + 1));
      if (split < 0 || !ipv4) throw invalid();
      raw =
        raw.slice(0, split + 1) +
        ((ipv4[0] << 8) | ipv4[1]).toString(16) +
        ':' +
        ((ipv4[2] << 8) | ipv4[3]).toString(16);
    }
    const halves = raw.split('::');
    if (halves.length > 2) throw invalid();
    const left = halves[0] ? halves[0].split(':') : [],
      right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) throw invalid();
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1))
      throw invalid();
    const words = [
      ...left.map((part) => parseInt(part, 16)),
      ...Array<number>(missing).fill(0),
      ...right.map((part) => parseInt(part, 16)),
    ];
    const loopback =
      (words.slice(0, 7).every((word) => word === 0) && words[7] <= 1) ||
      (words.slice(0, 5).every((word) => word === 0) &&
        [0, 0xffff].includes(words[5]) &&
        (words[6] >>> 8 === 127 || (words[6] === 0 && words[7] === 0)));
    let best = -1,
      length = 1;
    for (let i = 0; i < words.length; i++) {
      if (words[i] !== 0) continue;
      let end = i;
      while (end < words.length && words[end] === 0) end++;
      if (end - i > length) {
        best = i;
        length = end - i;
      }
      i = end - 1;
    }
    const text = words.map((word) => word.toString(16));
    const host =
      best < 0
        ? text.join(':')
        : text.slice(0, best).join(':') + '::' + text.slice(best + length).join(':');
    return { host: '[' + host + ']', loopback };
  }
  const host = value.toLowerCase().replace(/\.$/, '');
  // Do not interpret shorthand/octal/hex IP spellings differently on each host.
  if (/(?:^|\.)(?:\d+|0x[0-9a-f]+)$/i.test(host)) {
    const parts = ipv4Parts(host);
    if (!parts) throw new Error('请使用完整的 IPv4 地址或域名，不使用缩写 IP');
    return {
      host: parts.join('.'),
      loopback: parts[0] === 127 || parts.every((part) => part === 0),
    };
  }
  if (
    host.length > 253 ||
    host
      .split('.')
      .some((label) => label.length > 63 || !/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/.test(label))
  )
    throw invalid();
  return { host, loopback: host === 'localhost' };
}

/** Shared with the Node configuration command; requires no DOM URL global. */
export function normalizeApiBaseUrl(value: unknown, environment: ApiEnvironment): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${environment} 接口地址未配置`);
  const address = value.trim().replace(/\/+$/, '');
  const parts =
    /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9_.-]+)(?::([0-9]{1,5}))?(\/[^?#\s\\]*)?$/i.exec(address);
  if (
    !parts ||
    Array.from(address).some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\',
    )
  )
    throw new Error(`${environment} 接口地址必须为 HTTP(S) 地址，不含凭证、查询参数或片段`);
  const scheme = parts[1].toLowerCase(),
    { host, loopback } = normalizeHost(parts[2]);
  const port = parts[3] ? Number(parts[3]) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) throw new Error('接口端口无效');
  if (environment !== 'local' && (scheme !== 'https' || loopback))
    throw new Error(`${environment} 接口必须使用非本机的 HTTPS 地址`);
  const portSuffix =
    port && !((scheme === 'http' && port === 80) || (scheme === 'https' && port === 443))
      ? `:${port}`
      : '';
  return `${scheme}://${host}${portSuffix}${parts[4] || ''}`;
}

export function resolveApiConfiguration(
  config: unknown,
  runtime?: WechatEnvironmentAPI | null,
): { environment: ApiEnvironment; apiBaseUrl: string } {
  const environment = detectApiEnvironment(runtime);
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('小游戏接口配置无效');
  const settings = config as {
    apiBaseUrl?: unknown;
    environments?: Partial<Record<ApiEnvironment, { apiBaseUrl?: unknown }>>;
  };
  // A new environment map is authoritative; never silently borrow another endpoint.
  const value =
    'environments' in settings
      ? settings.environments?.[environment]?.apiBaseUrl
      : settings.apiBaseUrl;
  return { environment, apiBaseUrl: normalizeApiBaseUrl(value, environment) };
}
