/** 升级 helper 仅信任新 generation 在完整就绪后提交的受控回执。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  OTA_RESTART_STAGING_CLEANUP_ARGUMENT,
  OTA_RESTART_RECEIPT_ARGUMENT,
  OTA_RESTART_TOKEN_ARGUMENT,
  parseUpgradeRestartReceiptRequest,
  restartReceiptArguments,
  restartReceiptMatches,
  writeUpgradeRestartReceipt,
} from '../apps/desktop/platform/upgrade-restart-receipt.ts';

test('升级回执参数只能写入受控 OTA 暂存目录，并在就绪后匹配 token', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-restart-receipt-'));
  const userData = path.join(directory, 'user-data');
  const stagingDirectory = path.join(userData, 'dsh-forge', 'ota');
  const receiptPath = path.join(stagingDirectory, '.restart-test.restart.json');
  const runnerPath = path.join(stagingDirectory, '.upgrade-00000000-0000-4000-8000-000000000001.cmd');
  const token = '00000000-0000-4000-8000-000000000001';
  fs.mkdirSync(stagingDirectory, { recursive: true });
  try {
    const request = parseUpgradeRestartReceiptRequest([
      'electron',
      'main.js',
      OTA_RESTART_RECEIPT_ARGUMENT,
      receiptPath,
      OTA_RESTART_TOKEN_ARGUMENT,
      token,
      OTA_RESTART_STAGING_CLEANUP_ARGUMENT,
      runnerPath,
    ], userData);
    assert.deepEqual(request, { receiptPath, token, stagingCleanupPaths: [runnerPath] });
    if (!request) throw new Error('预期升级重启回执请求');
    assert.deepEqual(restartReceiptArguments(request, [runnerPath]), [
      OTA_RESTART_RECEIPT_ARGUMENT,
      receiptPath,
      OTA_RESTART_TOKEN_ARGUMENT,
      token,
      OTA_RESTART_STAGING_CLEANUP_ARGUMENT,
      runnerPath,
    ]);
    assert.equal(restartReceiptMatches(receiptPath, token), false);
    await writeUpgradeRestartReceipt(request);
    assert.equal(restartReceiptMatches(receiptPath, token), true);
    assert.equal(restartReceiptMatches(receiptPath, '00000000-0000-4000-8000-000000000002'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('升级回执拒绝重复参数、非 UUID token 和 OTA 目录外路径', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-restart-invalid-'));
  const userData = path.join(directory, 'user-data');
  const outside = path.join(directory, 'outside.restart.json');
  const receiptPath = path.join(userData, 'dsh-forge', 'ota', '.restart-test.restart.json');
  try {
    assert.throws(
      () => parseUpgradeRestartReceiptRequest([
        OTA_RESTART_RECEIPT_ARGUMENT,
        outside,
        OTA_RESTART_TOKEN_ARGUMENT,
        'not-a-token',
      ], userData),
      /回执参数无效|回执路径无效/,
    );
    assert.throws(
      () => parseUpgradeRestartReceiptRequest([
        OTA_RESTART_RECEIPT_ARGUMENT,
        outside,
        OTA_RESTART_RECEIPT_ARGUMENT,
        outside,
        OTA_RESTART_TOKEN_ARGUMENT,
        '00000000-0000-4000-8000-000000000001',
      ], userData),
      /回执参数无效/,
    );
    assert.throws(
      () => parseUpgradeRestartReceiptRequest([
        OTA_RESTART_RECEIPT_ARGUMENT,
        receiptPath,
        OTA_RESTART_TOKEN_ARGUMENT,
        '00000000-0000-4000-8000-000000000001',
        OTA_RESTART_STAGING_CLEANUP_ARGUMENT,
        outside,
      ], userData),
      /暂存清理路径无效/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
