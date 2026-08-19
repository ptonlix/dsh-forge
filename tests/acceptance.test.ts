/** 通过真实 acceptance 入口验证官方 profile、Fork 身份和不完整产物拒绝语义。 */
import assert from 'node:assert/strict';
import * as path from 'node:path';

import { runFoundationAcceptance } from '../src/acceptance/index.ts';

test('官方 profile、Fork 身份、runtime 升级和不完整产物端到端验收', () => {
  const result = runFoundationAcceptance({ root: path.resolve(__dirname, '..') });
  assert.equal(result.configHealthy, true);
  assert.equal(result.incompleteArtifactRejected, true);
});
