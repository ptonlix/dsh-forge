/** CI/本地发布前运行基础契约验收，并将失败转换为非零退出码。 */
import { runFoundationAcceptance } from '../src/acceptance/index.ts';
import { errorCode, errorMessage } from '../src/types.ts';

try {
  process.stdout.write(`${JSON.stringify(runFoundationAcceptance(), null, 2)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${errorCode(error) || 'ACCEPTANCE_FAILED'}: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
