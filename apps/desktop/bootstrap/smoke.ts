import * as fs from 'node:fs';
import * as path from 'node:path';
import { errorMessage } from '../runtime/types.ts';

export type SmokeStatus = 'starting' | 'passed' | 'failed';

let lastSmokePhase: string | null = null;

/** 判断当前 Electron 进程是否由 package:smoke 启动。 */
export function isSmokeMode(argv: readonly string[] = process.argv): boolean {
  return argv.includes('--dsh-forge-smoke');
}

/** 将 Electron 启动阶段写入 smoke 临时报告，覆盖无 stderr 的 GUI 进程失败。 */
export function writeSmokeReport(status: SmokeStatus, phase: string, error?: string): void {
  const report = process.env.DSH_FORGE_SMOKE_REPORT;
  if (!report) return;
  const previousPhase = lastSmokePhase;
  lastSmokePhase = phase;
  try {
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(
      report,
      `${JSON.stringify({
        schema: 'dsh-forge/electron-smoke@1',
        status,
        phase,
        ...(status === 'failed' && previousPhase ? { lastPhase: previousPhase } : {}),
        electron: process.versions.electron || null,
        electronAbi: process.versions.modules,
        platform: process.platform,
        architecture: process.arch,
        error: error || null,
      })}\n`,
      { mode: 0o600 },
    );
  } catch (writeError: unknown) {
    process.stderr.write(`DSH Forge smoke 报告写入失败: ${errorMessage(writeError)}\n`);
  }
}

/** Smoke 成功握手后延迟退出，给 renderer 和 Host 留出资源清理时间。 */
export function scheduleSmokeExit(
  requestExit: (reason: string) => Promise<void>,
  argv: readonly string[] = process.argv,
): void {
  if (!isSmokeMode(argv)) return;
  setTimeout(() => void requestExit('smoke-exit'), 1_000);
}
