import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compileProfile, verifyProfile } from '../compiler/index.ts';
import { composeCompiled } from '../composer/index.ts';
import { parseProfile } from '../core/schema.ts';
import { inspectPackage } from '../release/index.ts';
import { errorCode } from '../types.ts';

/**
 * 基础契约端到端验收：验证官方 profile 可编译、Fork 身份不会污染官方身份、
 * 未更新运行时矩阵的上游升级会被拒绝，以及不完整桌面产物不能通过检查。
 * 每次调用使用临时目录，结束时删除全部验收夹具。
 */

/** 运行基础发行链验收并返回可供脚本序列化的事实摘要。 */
export function runFoundationAcceptance({ root }: { readonly root?: string } = {}) {
  // 编译产物位于 tools/profile-toolchain/dist/acceptance，默认根目录需回到仓库根。
  const projectRoot = path.resolve(root || path.join(__dirname, '../../../..'));
  const official = compileProfile({ root: projectRoot });
  const verified = verifyProfile({ root: projectRoot });
  const dump = composeCompiled(verified, { overlay: { port: 38080, generationId: 'acceptance' } });
  if (!dump.healthy) throw new Error('官方 profile 的真实 DSH dump 不健康');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-acceptance-'));
  try {
    const forkDistribution = path.join(temporary, 'distribution.yml');
    fs.writeFileSync(
      forkDistribution,
      [
        'schema: dsh-forge/distribution@1',
        'id: dsh-forge-fork',
        'name: DSH Forge Fork',
        "packageScope: '@dsh-forge-fork'",
        'applicationId: ai.dshforge.fork',
        'version: 0.1.0',
        'defaultProfile: official',
        'platforms:',
        '  - os: darwin',
        '    architectures: [arm64]',
      ].join('\n'),
    );
    const fork = compileProfile({ root: projectRoot, distributionFile: forkDistribution, artifactsDir: temporary });
    if (fork.resolved.distribution.applicationId !== 'ai.dshforge.fork')
      throw new Error('Fork 身份未投影到 resolved manifest');

    const upgradedProfile = path.join(temporary, 'profile.yml');
    const officialProfile = fs.readFileSync(path.join(projectRoot, 'profiles', 'official', 'profile.yml'), 'utf8');
    fs.writeFileSync(upgradedProfile, officialProfile.replace('electronVersion: 43.4.0', 'electronVersion: 44.0.0'));
    let upgradeRejected = false;
    try {
      parseProfile(upgradedProfile);
    } catch (error) {
      upgradeRejected = errorCode(error) === 'RUNTIME_MATRIX_DRIFT';
    }
    if (!upgradeRejected) throw new Error('上游 runtime 升级未触发重新验证');

    const rejected = inspectPackage({
      packageRoot: path.join(temporary, 'missing.app'),
      targets: [],
      signing: { signed: false },
    });
    if (rejected.valid) throw new Error('不完整安装包未被拒绝');
    return Object.freeze({
      official: official.inputDigest,
      fork: fork.inputDigest,
      configHealthy: dump.healthy,
      incompleteArtifactRejected: true,
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
