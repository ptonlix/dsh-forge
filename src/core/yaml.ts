import * as fs from 'node:fs';
import YAML from 'yaml';

/** YAML 读写边界：只负责语法解析和序列化，不负责业务 schema 校验。 */

/** 解析 YAML 并保留文件名上下文；语法错误立即抛出，不返回部分文档。 */
export function parseYaml(input: string | Buffer, filename = '<内存>'): unknown {
  const document = YAML.parseDocument(String(input), { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0)
    throw new Error(`${filename}: ${document.errors.map((error) => error.message).join('; ')}`);
  return document.toJS();
}

/** 读取文件后解析 YAML；调用方必须继续执行对应 schema 的字段校验。 */
export function readYaml(file: string): unknown {
  return parseYaml(fs.readFileSync(file, 'utf8'), file);
}

/** 以稳定的人类可读格式序列化配置，不自动补换行，避免调用方重复换行。 */
export function stringifyYaml(value: unknown): string {
  return YAML.stringify(value).trimEnd();
}
