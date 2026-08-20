/** 项目业务错误；code 用于机器分支，details 用于诊断上下文且不会改变主消息。 */
export class ForgeError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, code = 'FORGE_ERROR', details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ForgeError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  /** 跨 CJS/ESM workspace 边界按稳定错误形状识别，避免重复加载类导致身份丢失。 */
  static override [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { readonly name?: unknown; readonly code?: unknown };
    return candidate.name === 'ForgeError' && typeof candidate.code === 'string';
  }
}

/** 创建并立即抛出 ForgeError，保证所有可预期失败都带稳定错误码。 */
export function fail(message: string, code: string, details: Record<string, unknown> = {}): never {
  throw new ForgeError(message, code, details);
}
