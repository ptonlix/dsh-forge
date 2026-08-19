/** 只检查签名身份配置，不执行签名；未配置时明确返回 unsigned-smoke 状态。 */
const platform = process.argv[2] || process.platform;
if (!['darwin', 'win32'].includes(platform)) throw new Error('平台必须是 darwin 或 win32');
const variable = platform === 'darwin' ? 'DSH_FORGE_MAC_SIGNING_IDENTITY' : 'DSH_FORGE_WINDOWS_SIGNING_IDENTITY';
if (!process.env[variable]) {
  process.stdout.write(`${platform} 未配置签名身份：仅允许 unsigned-smoke。\n`);
  process.exitCode = 2;
} else {
  process.stdout.write(`${platform} 签名身份已配置。\n`);
}
