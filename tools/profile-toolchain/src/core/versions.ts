/** 首版运行时版本矩阵；升级必须同时执行 profile、运行时闭包和安装包 smoke。 */
/** 发行版允许的上游运行时组合；变更必须重新生成并验证 profile artifact。 */
export const RUNTIME_MATRIX = Object.freeze({
  dshPackageFamily: '@deepseek-ai/dsh',
  dshVersion: '0.1.2-alpha.4',
  cordisPackage: '@deepseek-ai/cordis',
  cordisVersion: '4.0.2',
  electronVersion: '43.4.0',
  pnpmVersion: '11.7.0',
  nodeEngine: '>=20.0.0',
  desktopProtocol: 1,
  platforms: Object.freeze(['darwin-arm64', 'darwin-x64', 'win32-x64']),
  upgradeVerification: Object.freeze([
    'profile:resolve',
    'profile:verify',
    'dump-config',
    'package:inspect',
    '真实安装包 smoke',
  ]),
});
