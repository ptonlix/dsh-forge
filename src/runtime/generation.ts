import * as crypto from 'node:crypto';
import { fail } from '../core/errors.ts';
import { errorMessage } from '../types.ts';
import type {
  Disposable,
  GenerationHooks,
  GenerationLike,
  GenerationManagerOptions,
  JsonRecord,
  ProfileState,
  ProfileSummary,
  StateStore,
} from '../types.ts';

const STAGES = Object.freeze(['preparing', 'host-ready', 'renderer-ready', 'committed', 'failed', 'manual-recovery']);

/**
 * Generation 生命周期管理：把 host、renderer、窗口和桌面服务绑定到同一代 profile。
 * 启动失败最多回退到 last-known-good 一次；再次失败会持久化 manual recovery，
 * 防止 launcher 在不可信状态下无限重启或丢失失败事实。
 */

function id(): string {
  return `gen-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}
function immutable<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) immutable(child);
  return Object.freeze(value);
}

/** 一次 profile 运行实例；负责服务注册、关闭状态和有序资源释放。 */
export class Generation implements GenerationLike {
  readonly manager: GenerationManager;
  readonly profile: string;
  readonly context: JsonRecord;
  readonly id: string;
  stage: string = 'preparing';
  closed = false;
  private readonly services = new Set<Disposable>();

  constructor(manager: GenerationManager, profile: string, context: JsonRecord = {}) {
    this.manager = manager;
    this.profile = profile;
    this.context = context;
    this.id = id();
  }
  assertOpen() {
    if (this.closed) fail(`generation 已关闭: ${this.id}`, 'GENERATION_CLOSED');
  }
  attach(service: Disposable): void {
    this.assertOpen();
    this.services.add(service);
  }
  async dispose(reason = 'dispose') {
    if (this.closed) return;
    this.closed = true;
    let firstError = null;
    for (const service of this.services) {
      try {
        await service.dispose?.(reason);
      } catch (error) {
        firstError ||= error;
      }
    }
    try {
      await this.manager.hooks.dispose?.(this, reason);
    } catch (error) {
      firstError ||= error;
    }
    if (firstError) throw firstError;
  }
}

/** 协调 profile 选择、启动阶段超时、回退、持久化状态和退出流程。 */
export class GenerationManager {
  readonly stateStore: StateStore;
  readonly hooks: GenerationHooks;
  readonly healthDeadlineMs: number;
  readonly profiles: readonly ProfileSummary[];
  private state: ProfileState;
  current: Generation | null = null;
  private pendingSelection: { readonly profile: string; readonly promise: Promise<Generation> } | null = null;
  private recoveryAttempted = false;
  private exiting = false;

  constructor({ stateStore, hooks = {}, healthDeadlineMs = 15_000, profiles = [] }: GenerationManagerOptions) {
    if (!stateStore) fail('GenerationManager 需要 stateStore', 'GENERATION_CONFIG');
    this.stateStore = stateStore;
    this.hooks = hooks;
    this.healthDeadlineMs = healthDeadlineMs;
    this.profiles = profiles;
    this.state = stateStore.load();
    this.current = null;
    this.pendingSelection = null;
    this.recoveryAttempted = false;
    this.exiting = false;
    const activity = stateStore.readActivity();
    if (activity && !this.state.lastFailure)
      this.state.lastFailure = {
        target: activity.profile ?? null,
        stage: 'crash-recovery',
        attempt: 0,
        reason: '检测到未完成 generation 运行记录',
        occurredAt: new Date().toISOString(),
      };
  }
  get snapshot() {
    return immutable(JSON.parse(JSON.stringify(this.state)));
  }
  listProfiles(): ProfileSummary[] {
    return this.profiles.map((profile) => ({
      ...profile,
      selectable: profile.exists !== false && !profile.error,
      reason: profile.error || null,
    }));
  }
  select(profileName: string): Promise<Generation> {
    if (this.exiting) fail('launcher 正在退出', 'GENERATION_EXITING');
    if (this.pendingSelection) {
      if (this.pendingSelection.profile === profileName) return this.pendingSelection.promise;
      fail(`已有其他 profile 选择等待处理: ${this.pendingSelection.profile}`, 'PROFILE_SELECTION_BUSY');
    }
    const target = this.profiles.find((profile) => profile.name === profileName);
    if (target && target.selectable === false) fail(`profile 不可选择: ${profileName}`, 'PROFILE_UNSELECTABLE');
    const previous = this.state.pending;
    if (previous && previous.profile !== profileName)
      fail(`已有 pending profile: ${previous.profile}`, 'PROFILE_SELECTION_BUSY');
    this.state = this.stateStore.save({
      ...this.state,
      pending: { profile: profileName, requestedAt: new Date().toISOString() },
    });
    const promise = this._relaunch(profileName).finally(() => {
      if (this.pendingSelection?.promise === promise) this.pendingSelection = null;
    });
    this.pendingSelection = { profile: profileName, promise };
    return promise;
  }
  async retry() {
    const profile = this.state.lastFailure?.target || this.state.pending?.profile;
    if (!profile) fail('没有可重试的 profile', 'NO_RETRY_TARGET');
    return this.select(profile);
  }
  private async _relaunch(
    profileName: string,
    recoveryFailure: ProfileState['lastFailure'] = null,
  ): Promise<Generation> {
    if (this.current) await this.current.dispose('profile-select');
    const generation = new Generation(this, profileName, { recovery: this.recoveryAttempted });
    this.current = generation;
    this.state = this.stateStore.save({ ...this.state, generationId: generation.id });
    this.stateStore.markActivity({
      generationId: generation.id,
      profile: profileName,
      startedAt: new Date().toISOString(),
    });
    try {
      await this._deadline(this.hooks.prepare?.(generation), 'preparing');
      generation.stage = 'preparing';
      await this._deadline(this.hooks.hostReady?.(generation), 'host-readiness');
      generation.stage = 'host-ready';
      await this._deadline(this.hooks.webReady?.(generation), 'web-readiness');
      await this._deadline(this.hooks.windowReady?.(generation), 'window-readiness');
      await this._deadline(this.hooks.rendererReady?.(generation), 'renderer-ready');
      generation.stage = 'renderer-ready';
      await this._deadline(this.hooks.interactionReady?.(generation), 'interaction-ready');
      generation.stage = 'committed';
      this.state = this.stateStore.save({
        ...this.state,
        active: profileName,
        pending: null,
        lastKnownGood: profileName,
        generationId: generation.id,
        lastFailure: recoveryFailure,
        manualRecovery: null,
      });
      this.stateStore.clearActivity();
      this.recoveryAttempted = false;
      return generation;
    } catch (error) {
      const failedStage = generation.stage;
      generation.stage = 'failed';
      const failure = {
        target: profileName,
        stage: failedStage,
        attempt: this.recoveryAttempted ? 1 : 0,
        reason: errorMessage(error),
        occurredAt: new Date().toISOString(),
      };
      this.state = this.stateStore.save({
        ...this.state,
        pending: { profile: profileName, requestedAt: this.state.pending?.requestedAt || new Date().toISOString() },
        lastFailure: failure,
      });
      await generation.dispose('failed');
      if (!this.recoveryAttempted && this.state.lastKnownGood && this.state.lastKnownGood !== profileName) {
        this.recoveryAttempted = true;
        return this._relaunch(this.state.lastKnownGood, failure);
      }
      generation.stage = 'manual-recovery';
      this.state = this.stateStore.save({
        ...this.state,
        manualRecovery: { target: profileName, reason: errorMessage(error), stage: failedStage },
        pending: null,
      });
      fail(`generation 启动失败，需人工恢复: ${errorMessage(error)}`, 'GENERATION_FAILED', {
        target: profileName,
        stage: generation.stage,
      });
    }
  }
  private _deadline(value: void | Promise<void> | undefined, stage: string): Promise<void> {
    if (!value || typeof value.then !== 'function') return Promise.resolve(value);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${stage} 超时`)), this.healthDeadlineMs);
      value.then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
  async hideWindow() {
    if (this.current) await this.hooks.hideWindow?.(this.current);
  }
  async dispose(reason = 'exit') {
    this.exiting = true;
    if (this.current) await this.current.dispose(reason);
    this.stateStore.clearActivity();
  }
  async signal(signal: string): Promise<void> {
    await this.dispose(`signal:${signal}`);
  }
}

export { STAGES };
