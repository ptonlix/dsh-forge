#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveProfile, verifyProfile, findLatestArtifact } from '../compiler/index.ts';
import { composeCompiled, writeConfigDump } from '../composer/index.ts';
import { loadStaticCatalog, verifyCatalog } from '../trust/catalog.ts';
import { inspectPackage, releaseGate, verifyEvidence } from '../release/index.ts';
import { parseDistribution, parseProfile } from '../core/schema.ts';
import { errorCode, errorMessage } from '../types.ts';

/**
 * 可审计 CLI 入口。命令只组合已验证的 compiler/composer/catalog/release API，
 * 不直接修改 profile 源文件；每个成功命令输出 JSON，非零返回值表示对应门禁失败。
 */

const sourceRoot = path.resolve(__dirname, '../..');
const root = fs.existsSync(path.join(sourceRoot, 'distribution.yml'))
  ? sourceRoot
  : path.resolve(__dirname, '../../..');

function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
/** 执行一个已声明子命令；未知命令返回 2 并打印固定用法。 */
export function main(command = process.argv[2]): number | void {
  if (command === 'profile:resolve') {
    const compiled = resolveProfile({ root });
    const dump = writeConfigDump(compiled, { overlay: { port: 38080, generationId: 'profile-resolve' } });
    json({ outputDir: compiled.outputDir, inputDigest: compiled.inputDigest, configHealthy: dump.healthy });
    return dump.healthy ? 0 : 1;
  }
  if (command === 'profile:verify') {
    const compiled = verifyProfile({ root });
    const dump = composeCompiled(compiled, { overlay: { port: 38080, generationId: 'profile-resolve' } });
    const existing = path.join(compiled.outputDir, 'config-dump.json');
    if (
      !fs.existsSync(existing) ||
      JSON.stringify(JSON.parse(fs.readFileSync(existing, 'utf8'))) !== JSON.stringify(dump)
    )
      throw new Error('真实 DSH 配置转储漂移；请重新执行 profile:resolve');
    json({ verified: true, configHealthy: dump.healthy });
    return dump.healthy ? 0 : 1;
  }
  if (command === 'catalog:verify')
    return json(verifyCatalog(loadStaticCatalog(path.join(root, 'catalog/catalog.yml'))));
  if (command === 'package:inspect') {
    const distribution = parseDistribution(path.join(root, 'distribution.yml'));
    const profile = parseProfile(path.join(root, 'profiles', distribution.defaultProfile, 'profile.yml'));
    const artifact = findLatestArtifact(root, distribution.id, profile.name);
    if (!artifact || !fs.existsSync(path.join(artifact, 'runtime-manifest.json')))
      throw new Error('没有真实 Electron 产物；请先运行 package:desktop');
    const runtime = JSON.parse(fs.readFileSync(path.join(artifact, 'runtime-manifest.json'), 'utf8')) as Parameters<
      typeof inspectPackage
    >[0];
    const result = inspectPackage(runtime);
    json({ ...result, signing: runtime.signing, artifact: runtime.artifact });
    return result.valid ? 0 : 1;
  }
  if (command === 'release:gate') {
    const compiled = verifyProfile({ root });
    const dump = composeCompiled(compiled, { overlay: { port: 38080, generationId: 'release-gate' } });
    const catalog = verifyCatalog(loadStaticCatalog(path.join(root, 'catalog/catalog.yml')));
    const artifact = findLatestArtifact(root, compiled.distribution.id, compiled.profile.name);
    const runtime =
      artifact && fs.existsSync(path.join(artifact, 'runtime-manifest.json'))
        ? JSON.parse(fs.readFileSync(path.join(artifact, 'runtime-manifest.json'), 'utf8'))
        : null;
    const inspection = runtime ? inspectPackage(runtime) : { valid: false };
    const smoke =
      artifact && fs.existsSync(path.join(artifact, 'package-smoke.json'))
        ? JSON.parse(fs.readFileSync(path.join(artifact, 'package-smoke.json'), 'utf8'))
        : { healthy: false };
    const evidence =
      artifact && fs.existsSync(path.join(artifact, 'package-evidence.json'))
        ? verifyEvidence(JSON.parse(fs.readFileSync(path.join(artifact, 'package-evidence.json'), 'utf8')), {
            sbomFile: path.join(artifact, 'sbom.input.json'),
            licenseFile: path.join(artifact, 'THIRD-PARTY-NOTICES.txt'),
          })
        : { valid: false };
    const result = releaseGate({
      profileVerified: compiled.verified,
      configDump: dump,
      packageInspection: inspection,
      catalogVerified: catalog,
      manifest: runtime,
      updateConfigured: compiled.distribution.updates.enabled,
      packageSmoke: smoke,
      evidence,
    });
    json(result);
    return 0;
  }
  if (command === 'dump-config') {
    const compiled = resolveProfile({ root });
    const dump = composeCompiled(compiled, { overlay: { port: 38080, generationId: 'dump' } });
    json(dump);
    return dump.healthy ? 0 : 1;
  }
  if (command === 'docs:check') {
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const name of fs.readdirSync(directory)) {
        const file = path.join(directory, name);
        if (fs.statSync(file).isDirectory()) walk(file);
        else if (file.endsWith('.md')) files.push(file);
      }
    };
    walk(path.join(root, 'docs'));
    walk(path.join(root, 'openspec'));
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (/[ \t]+$/m.test(content)) throw new Error(`文档尾随空格: ${file}`);
      for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (!target) continue;
        if (/^(?:https?:|#|mailto:)/.test(target)) continue;
        const [relative] = target.split('#');
        if (!relative) continue;
        if (!fs.existsSync(path.resolve(path.dirname(file), relative)))
          throw new Error(`Markdown 链接不存在: ${file} -> ${target}`);
      }
    }
    json({ valid: true, files: files.length });
    return 0;
  }
  process.stderr.write(
    '用法: profile:resolve | profile:verify | dump-config | catalog:verify | package:inspect | release:gate | docs:check\n',
  );
  return 2;
}

try {
  const exitCode = main();
  process.exitCode = typeof exitCode === 'number' ? exitCode : 0;
} catch (error) {
  process.stderr.write(`${errorCode(error) || 'ERROR'}: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
