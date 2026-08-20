/** loopback 页面导航策略；只允许当前 generation 的完整 authority。 */
export interface LoopbackAuthority {
  readonly protocol: 'http:';
  readonly hostname: string;
  readonly port: string;
}

export interface WindowOpenDecision {
  readonly action: 'deny' | 'external';
  readonly url?: string;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** 从 readiness URL 固定主窗口的 loopback authority。 */
export function loopbackAuthority(value: string): LoopbackAuthority {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || !url.port)
    throw new Error(`不允许的 loopback URL: ${value}`);
  return Object.freeze({ protocol: 'http:', hostname: url.hostname, port: url.port });
}

/** 判断导航是否仍然处于当前 generation 的 loopback authority。 */
export function isAllowedLoopbackNavigation(value: string, authority: LoopbackAuthority): boolean {
  const url = parseUrl(value);
  return Boolean(
    url && url.protocol === authority.protocol && url.hostname === authority.hostname && url.port === authority.port,
  );
}

/** 新窗口一律不在应用内创建；允许的外链由调用方交给系统浏览器。 */
export function decideWindowOpen(value: string, authority: LoopbackAuthority): WindowOpenDecision {
  const url = parseUrl(value);
  if (!url) return Object.freeze({ action: 'deny' });
  if (isAllowedLoopbackNavigation(value, authority)) return Object.freeze({ action: 'deny' });
  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:')
    return Object.freeze({ action: 'external', url: value });
  return Object.freeze({ action: 'deny' });
}
