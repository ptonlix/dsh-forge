/** CI/本地发布前运行基础契约验收，并将失败转换为非零退出码。 */
import { runFoundationAcceptance } from '@dsh-forge/profile-toolchain/acceptance';
import { errorCode, errorMessage } from '@dsh-forge/profile-toolchain/types';

try {
  process.stdout.write(`${JSON.stringify(runFoundationAcceptance(), null, 2)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${errorCode(error) || 'ACCEPTANCE_FAILED'}: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
