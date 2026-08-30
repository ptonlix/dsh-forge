import type {
  FullPackageUpdate,
  FullPackageUpdater,
  UpgradeManagerCapability,
  UpgradeManagerStatus,
} from '@dsh-forge/desktop-services-local/launcher';
import { offerFullPackageUpgrade } from './full-package-offer.ts';

export const UPGRADE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1_000;

export interface UpgradeCoordinatorOptions {
  readonly updater: FullPackageUpdater;
  readonly version: string;
  readonly build: number | null;
  readonly confirm: (update: { readonly version: string; readonly build: number }) => Promise<boolean>;
  readonly requestExit: (reason: string) => Promise<void>;
  readonly now?: () => Date;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string')
    return (error as { readonly code: string }).code;
  return 'OTA_CHECK_FAILED';
}

function status(snapshot: UpgradeManagerStatus): UpgradeManagerStatus {
  return Object.freeze({
    ...snapshot,
    available: snapshot.available ? Object.freeze({ ...snapshot.available }) : null,
  });
}

/** generation 所有的 OTA 状态机；浏览器只能通过私有 Remote 读取其投影。 */
export class UpgradeCoordinator implements UpgradeManagerCapability {
  private snapshot: UpgradeManagerStatus;
  private candidate: FullPackageUpdate | null = null;
  private checking: Promise<UpgradeManagerStatus> | null = null;
  private upgrading: Promise<UpgradeManagerStatus> | null = null;
  private checkAbort: AbortController | null = null;
  private upgradeAbort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: UpgradeCoordinatorOptions) {
    const supported = options.updater.isSupported();
    this.snapshot = status({
      version: options.version,
      build: options.build,
      support: supported ? 'supported' : 'unsupported',
      phase: supported ? 'idle' : 'unsupported',
      lastCheckedAt: null,
      available: null,
      errorCode: null,
    });
  }

  status(): UpgradeManagerStatus {
    return this.snapshot;
  }

  /** generation 已提交后调用；自动检查绝不显示原生确认或下载完整包。 */
  start(): void {
    if (!this.disposed && this.snapshot.support === 'supported') void this.check();
  }

  check(): Promise<UpgradeManagerStatus> {
    if (this.disposed || this.snapshot.support === 'unsupported') return Promise.resolve(this.snapshot);
    if (this.checking) return this.checking;
    const controller = new AbortController();
    this.checkAbort = controller;
    this.set({ phase: 'checking', available: null, errorCode: null });
    let taskRef: Promise<UpgradeManagerStatus> | null = null;
    const task = (async () => {
      try {
        const result = await this.options.updater.check(controller.signal);
        if (this.disposed) return this.snapshot;
        const checkedAt = (this.options.now || (() => new Date()))().toISOString();
        if (result.kind === 'available') {
          this.candidate = result.update;
          this.set({
            phase: 'available',
            lastCheckedAt: checkedAt,
            available: { version: result.update.version, build: result.update.build },
            errorCode: null,
          });
        } else if (result.kind === 'current') {
          this.candidate = null;
          this.set({ phase: 'current', lastCheckedAt: checkedAt, available: null, errorCode: null });
        } else if (result.kind === 'unsupported') {
          this.candidate = null;
          this.set({ phase: 'unsupported', support: 'unsupported', lastCheckedAt: checkedAt, available: null, errorCode: null });
        } else {
          this.candidate = null;
          this.set({ phase: 'error', lastCheckedAt: checkedAt, available: null, errorCode: result.code });
        }
      } catch (error: unknown) {
        if (!this.disposed) {
          this.candidate = null;
          this.set({
            phase: 'error',
            lastCheckedAt: (this.options.now || (() => new Date()))().toISOString(),
            available: null,
            errorCode: errorCode(error),
          });
        }
      } finally {
        if (this.checkAbort === controller) this.checkAbort = null;
        if (this.checking === taskRef) this.checking = null;
        if (!this.disposed && this.snapshot.support === 'supported') this.scheduleNextCheck();
      }
      return this.snapshot;
    })();
    taskRef = task;
    this.checking = task;
    return task;
  }

  startUpgrade(): Promise<UpgradeManagerStatus> {
    if (this.disposed || this.snapshot.support === 'unsupported') return Promise.resolve(this.snapshot);
    if (this.upgrading) return this.upgrading;
    this.clearTimer();
    let taskRef: Promise<UpgradeManagerStatus> | null = null;
    const task = (async () => {
      const fresh = await this.check();
      const candidate = this.candidate;
      if (this.disposed || fresh.phase !== 'available' || !candidate) return this.snapshot;
      const controller = new AbortController();
      this.upgradeAbort = controller;
      this.set({ phase: 'preparing', errorCode: null });
      try {
        const result = await offerFullPackageUpgrade({
          updater: this.options.updater,
          update: candidate,
          confirm: this.options.confirm,
          requestExit: this.options.requestExit,
          signal: controller.signal,
        });
        if (this.disposed) return this.snapshot;
        if (result.kind === 'declined') this.set({ phase: 'available', errorCode: null });
        else if (result.kind === 'failed') this.set({ phase: 'error', available: null, errorCode: result.code });
        else if (result.kind === 'unavailable') this.set({ phase: 'current', available: null, errorCode: null });
        return this.snapshot;
      } finally {
        if (this.upgradeAbort === controller) this.upgradeAbort = null;
        if (this.upgrading === taskRef) this.upgrading = null;
      }
    })();
    taskRef = task;
    this.upgrading = task;
    return task;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.checkAbort?.abort();
    this.upgradeAbort?.abort();
    this.options.updater.cancel();
  }

  private set(patch: Partial<UpgradeManagerStatus>): void {
    this.snapshot = status({ ...this.snapshot, ...patch });
  }

  private scheduleNextCheck(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check();
    }, UPGRADE_CHECK_INTERVAL_MS);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
