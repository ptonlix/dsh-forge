/** 测试辅助断言只比较规范化结构，避免 YAML/JSON 键顺序造成无意义失败。 */
import assert from 'node:assert/strict';
import { parseYaml } from '../src/core/yaml.ts';
import { stable, digest } from '../src/core/digest.ts';

export function assertNormalizedYamlEqual(left: string, right: string): void {
  assert.deepEqual(stable(parseYaml(left)), stable(parseYaml(right)));
}
export function assertNormalizedJsonEqual(left: unknown, right: unknown): void {
  assert.deepEqual(
    stable(typeof left === 'string' ? JSON.parse(left) : left),
    stable(typeof right === 'string' ? JSON.parse(right) : right),
  );
}
export function assertInputDigest(input: unknown, expected: string): void {
  assert.equal(digest(input), expected);
}
export function assertResolvedManifest(manifest: { schema: string; inputDigest: string }): void {
  assert.equal(manifest.schema, 'dsh-forge/resolved-manifest@1');
  assert.match(manifest.inputDigest, /^[a-f0-9]{64}$/);
}
export function assertConfigDump(dump: { layers?: unknown[]; lines?: unknown[]; diagnostics?: unknown[] }): void {
  assert.ok(Array.isArray(dump.layers));
  assert.ok(Array.isArray(dump.lines));
  assert.ok(Array.isArray(dump.diagnostics));
}
