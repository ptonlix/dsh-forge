import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fail } from '../core/errors.ts';
import { errorMessage } from '../types.ts';
import type { ActivityRecord, ProfileState, StateStore } from '../types.ts';

const STATE_VERSION = 1;
const EMPTY_STATE = Object.freeze({
  version: STATE_VERSION,
  active: null,
  pending: null,
  lastKnownGood: null,
  generationId: null,
  lastFailure: null,
  manualRecovery: null,
});

/**
 * 本地状态存储：状态目录和两个状态文件必须是普通文件而非符号链接，
 * 保存采用临时文件、fsync 和 rename，避免进程崩溃留下半个 JSON。
 */

function rejectSymlink(file: string): void {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    fail(`拒绝符号链接状态路径: ${file}`, 'STATE_SYMLINK');
}

/** 持久化 active/pending/last-known-good 与 generation 活动记录。 */
export class ProfileStateStore implements StateStore {
  readonly directory: string;
  readonly file: string;
  readonly activityFile: string;

  constructor(directory: string) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'profile-state.json');
    this.activityFile = path.join(this.directory, 'generation-active.json');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    rejectSymlink(this.directory);
    rejectSymlink(this.file);
    rejectSymlink(this.activityFile);
    const mode = fs.statSync(this.directory).mode & 0o777;
    if ((mode & 0o077) !== 0) fs.chmodSync(this.directory, 0o700);
  }
  load(): ProfileState {
    if (!fs.existsSync(this.file)) return { ...EMPTY_STATE };
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (value.version !== STATE_VERSION) throw new Error('unsupported version');
      return { ...EMPTY_STATE, ...value } as ProfileState;
    } catch (error) {
      return {
        ...EMPTY_STATE,
        lastFailure: {
          target: null,
          stage: 'state-read',
          attempt: 0,
          reason: `状态损坏: ${errorMessage(error)}`,
          occurredAt: new Date().toISOString(),
        },
      };
    }
  }
  save(state: ProfileState): ProfileState {
    rejectSymlink(this.file);
    const temp = path.join(this.directory, `.profile-state.${process.pid}.${crypto.randomUUID()}.tmp`);
    const data = `${JSON.stringify({ ...state, version: STATE_VERSION }, null, 2)}\n`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, this.file);
    return this.load();
  }
  markActivity(record: ActivityRecord): void {
    rejectSymlink(this.activityFile);
    const temp = `${this.activityFile}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, this.activityFile);
  }
  clearActivity() {
    rejectSymlink(this.activityFile);
    if (fs.existsSync(this.activityFile)) fs.unlinkSync(this.activityFile);
  }
  readActivity(): ActivityRecord | null {
    if (!fs.existsSync(this.activityFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.activityFile, 'utf8'));
    } catch {
      return { corrupt: true };
    }
  }
}

export { STATE_VERSION, EMPTY_STATE };
