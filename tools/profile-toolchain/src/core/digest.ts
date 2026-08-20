import * as crypto from 'node:crypto';

/** 确定性摘要工具；对象先按键排序，避免输入字段顺序造成伪漂移。 */

/** 对字符串、Buffer 或规范化后的结构化值计算 SHA-256。 */
export function digest(value: unknown): string {
  const input = Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(stable(value));
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** 递归排序对象键；数组顺序保持不变，因为数组顺序属于配置语义。 */
export function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = stable(record[key]);
        return normalized;
      }, {});
  }
  return value;
}
