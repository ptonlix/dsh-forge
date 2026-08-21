#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveProfile, verifyProfile, findLatestArtifact } from '../compiler/index.ts';
import { composeCompiled, writeConfigDump } from '../composer/index.ts';
import { loadStaticCatalog, verifyCatalog } from '../trust/catalog.ts';
import { inspectPackage, releaseGate, verifyEvidence } from '../release/index.ts';
import { parseDistribution, parseProfile } from '../core/schema.ts';
import { parseYaml } from '../core/yaml.ts';
import { errorCode, errorMessage } from '../types.ts';

/**
 * 可审计 CLI 入口。命令只组合已验证的 compiler/composer/catalog/release API，
 * 不直接修改 profile 源文件；每个成功命令输出 JSON，非零返回值表示对应门禁失败。
 */

const sourceRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.resolve(__dirname, '../../../..');
const root = fs.existsSync(path.join(sourceRoot, 'distribution.yml')) ? sourceRoot : repositoryRoot;

function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

interface SelectedProfile {
  readonly name: string;
  readonly file: string;
}

/** 统一解析显式 profile；显式名称无效时绝不回退到默认 profile。 */
function selectProfile(name: string | undefined): SelectedProfile {
  const distribution = parseDistribution(path.join(root, 'distribution.yml'), {
    profilesRoot: path.join(root, 'profiles'),
  });
  const selected = name || distribution.defaultProfile;
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(selected)) throw new Error(`profile 名称无效: ${selected}`);
  const file = path.join(root, 'profiles', selected, 'profile.yml');
  if (!fs.existsSync(file)) throw new Error(`profile 不存在: ${selected}`);
  const profile = parseProfile(file);
  if (profile.name !== selected) throw new Error(`profile manifest 名称不一致: ${selected} / ${profile.name}`);
  return Object.freeze({ name: selected, file });
}

/** 校验设计文档中带标记的 YAML、CLI 命令和禁止的双轨架构表述。 */
function validateDocumentContracts(files: readonly string[]): void {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    readonly scripts?: Record<string, string>;
  };
  const packageScripts = scripts.scripts || {};
  const forbidden = ['当前已实现布局', '后续目标布局', '并列替代布局'];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const phrase of forbidden)
      if (content.includes(phrase)) throw new Error(`文档包含双轨架构表述: ${file} -> ${phrase}`);
    for (const match of content.matchAll(/pnpm run ([a-z0-9:-]+)/g)) {
      const command = match[1];
      if (command && !packageScripts[command]) throw new Error(`文档命令不存在: ${file} -> ${command}`);
    }
    if (content.includes('@dsh-forge/desktop-plugin'))
      throw new Error(`文档引用已删除 desktop-plugin: ${file}`);
    if (
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@dsh-forge\/desktop-services-local(?:['"]|\/)/.test(content) &&
      !file.endsWith(`${path.sep}desktop-services-local${path.sep}README.md`)
    )
      throw new Error(`文档不得将私有 provider 作为 consumer 接口: ${file}`);
    for (const [name, parser] of [
      ['distribution', (filePath: string) => parseDistribution(filePath)],
      ['profile', (filePath: string) => parseProfile(filePath)],
    ] as const) {
      const marker = `<!-- dsh-forge-example:${name} -->`;
      const start = content.indexOf(marker);
      if (start < 0) continue;
      const block = content.slice(start).match(/```yaml\s*\n([\s\S]*?)\n```/);
      if (!block?.[1]) throw new Error(`文档示例缺少 YAML 内容: ${file} -> ${name}`);
      const parsed = parseYaml(block[1], `${file}:${name}`);
      if (!parsed || typeof parsed !== 'object') throw new Error(`文档示例不是 YAML 对象: ${file} -> ${name}`);
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-doc-example-'));
      const exampleFile = path.join(temporary, `${name}.yml`);
      try {
        fs.writeFileSync(exampleFile, block[1], { mode: 0o600 });
        parser(exampleFile);
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
}

/** README 示例与 NodeNext consumer fixture 必须同步验证，避免文档导入私有路径。 */
function validateDesktopServiceReadme(root: string): void {
  const readme = path.join(root, 'packages', 'desktop-services', 'README.md');
  const content = fs.readFileSync(readme, 'utf8');
  const marker = '<!-- dsh-forge-example:desktop-services-consumer -->';
  const start = content.indexOf(marker);
  const example = start < 0 ? null : content.slice(start).match(/```ts\s*\n([\s\S]*?)\n```/);
  if (!example?.[1]) throw new Error('desktop-services README 缺少标记 TypeScript 示例');
  if (!example[1].includes("from '@dsh-forge/desktop-services'"))
    throw new Error('desktop-services README 示例没有使用公开 import');
  if (example[1].includes('desktop-services-local') || example[1].includes('desktop-plugin'))
    throw new Error('desktop-services README 示例引用私有或已删除路径');
  const consumer = path.join(root, 'tests', 'fixtures', 'desktop-services-consumer', 'tsconfig.json');
  const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
  const result = spawnSync(tsc, ['-p', consumer, '--noEmit'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`desktop-services consumer 编译失败: ${(result.stderr || result.stdout).trim()}`);
}

/** 执行一个已声明子命令；未知命令返回 2 并打印固定用法。 */
export function main(command = process.argv[2], profileName = process.argv[3]): number | void {
  const requestedProfile = profileName === '--' ? process.argv[4] : profileName;
  if (command === 'profile:resolve') {
    const selected = selectProfile(requestedProfile);
    const compiled = resolveProfile({ root, profileName: selected.name, profileFile: selected.file });
    const dump = writeConfigDump(compiled, { overlay: { port: 38080, generationId: 'profile-resolve' } });
    json({
      profile: compiled.profile.name,
      outputDir: compiled.outputDir,
      inputDigest: compiled.inputDigest,
      configHealthy: dump.healthy,
    });
    return dump.healthy ? 0 : 1;
  }
  if (command === 'profile:verify') {
    const selected = selectProfile(requestedProfile);
    const compiled = verifyProfile({ root, profileName: selected.name, profileFile: selected.file });
    const dump = composeCompiled(compiled, { overlay: { port: 38080, generationId: 'profile-resolve' } });
    const existing = path.join(compiled.outputDir, 'config-dump.json');
    if (
      !fs.existsSync(existing) ||
      JSON.stringify(JSON.parse(fs.readFileSync(existing, 'utf8'))) !== JSON.stringify(dump)
    )
      throw new Error('真实 DSH 配置转储漂移；请重新执行 profile:resolve');
    json({ profile: compiled.profile.name, verified: true, configHealthy: dump.healthy });
    return dump.healthy ? 0 : 1;
  }
  if (command === 'catalog:verify')
    return json(verifyCatalog(loadStaticCatalog(path.join(root, 'catalog/catalog.yml'))));
  if (command === 'package:inspect') {
    const selected = selectProfile(requestedProfile);
    const distribution = parseDistribution(path.join(root, 'distribution.yml'));
    const artifact = findLatestArtifact(root, distribution.id, selected.name);
    if (!artifact || !fs.existsSync(path.join(artifact, 'runtime-manifest.json')))
      throw new Error('没有真实 Electron 产物；请先运行 package:desktop');
    const runtime = JSON.parse(fs.readFileSync(path.join(artifact, 'runtime-manifest.json'), 'utf8')) as Parameters<
      typeof inspectPackage
    >[0];
    const result = inspectPackage(runtime);
    json({ profile: selected.name, ...result, signing: runtime.signing, artifact: runtime.artifact });
    return result.valid ? 0 : 1;
  }
  if (command === 'release:gate') {
    const selected = selectProfile(requestedProfile);
    const compiled = verifyProfile({ root, profileName: selected.name, profileFile: selected.file });
    const dump = composeCompiled(compiled, { overlay: { port: 38080, generationId: 'release-gate' } });
    const catalog = verifyCatalog(loadStaticCatalog(path.join(root, 'catalog/catalog.yml')));
    const artifact = findLatestArtifact(root, compiled.distribution.id, compiled.profile.name);
    const runtime =
      artifact && fs.existsSync(path.join(artifact, 'runtime-manifest.json'))
        ? JSON.parse(fs.readFileSync(path.join(artifact, 'runtime-manifest.json'), 'utf8'))
        : null;
    const inspection = runtime ? inspectPackage(runtime) : { valid: false };
    const smokes = artifact
      ? fs
        .readdirSync(artifact)
        .filter((file) => /^package-smoke\.(?:darwin|win32)-(?:arm64|x64|ia32)\.json$/.test(file))
        .sort()
        .map((file) => JSON.parse(fs.readFileSync(path.join(artifact, file), 'utf8')))
      : [];
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
      packageSmokes: smokes,
      evidence,
    });
    json(result);
    return 0;
  }
  if (command === 'dump-config') {
    const selected = selectProfile(requestedProfile);
    const compiled = resolveProfile({ root, profileName: selected.name, profileFile: selected.file });
    const dump = composeCompiled(compiled, { overlay: { port: 38080, generationId: 'dump' } });
    json({ ...dump, profile: compiled.profile.name });
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
    for (const packageReadme of [
      path.join(root, 'packages', 'desktop-services', 'README.md'),
      path.join(root, 'packages', 'desktop-services-local', 'README.md'),
    ]) {
      if (!fs.existsSync(packageReadme)) throw new Error(`缺少桌面服务 README: ${packageReadme}`);
      files.push(packageReadme);
    }
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
    validateDocumentContracts(files.filter((file) => file.includes(`${path.sep}docs${path.sep}`)));
    validateDesktopServiceReadme(root);
    json({ valid: true, files: files.length });
    return 0;
  }
  process.stderr.write(
    '用法: profile:resolve [profile] | profile:verify [profile] | dump-config [profile] | catalog:verify | package:inspect [profile] | release:gate [profile] | docs:check\n',
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
