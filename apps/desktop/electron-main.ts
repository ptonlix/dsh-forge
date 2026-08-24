import { app, dialog } from 'electron';
import { errorMessage } from './runtime/types.ts';
import { isSmokeMode, writeSmokeReport } from './bootstrap/smoke.ts';
import { startDesktop } from './bootstrap/start-desktop.ts';

/** Electron 唯一入口：启动公共编排，并为未捕获异常提供平台统一兜底。 */

void startDesktop().catch((error: unknown) => {
  const diagnostic = error instanceof Error && error.stack ? error.stack : errorMessage(error);
  writeSmokeReport('failed', 'startup', diagnostic);
  process.stderr.write(`DSH Forge Desktop 启动失败:\n${diagnostic}\n`);
  if (isSmokeMode()) {
    app.exit(1);
  } else {
    dialog.showErrorBox('DSH Forge 启动失败', diagnostic);
    app.exit(1);
  }
});
