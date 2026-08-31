/** 平台升级 helper 的内部路径、退出顺序、清理和 Ubuntu 回滚测试。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import {
  copyMacosApplication,
  createFullPackageUpgradeConfiguration,
  prepareFullPackageUpgrade,
  runFullPackageUpgrade,
  type UpgradeHelperDependencies,
} from '../apps/desktop/platform/full-package-upgrade.ts';

function configurationFile(directory: string, value: Record<string, unknown>): string {
  const file = path.join(directory, 'helper.json');
  const platform = value.platform;
  fs.writeFileSync(file, JSON.stringify({
    ...value,
    schema: 'dsh-forge/full-package-upgrade@3',
    ...(platform === 'windows' && typeof value.windowsExecutable !== 'string'
      ? { windowsExecutable: value.stagedPackage }
      : {}),
    restartReceipt: {
      receiptPath: path.join(directory, '.restart-test.restart.json'),
      token: '00000000-0000-4000-8000-000000000001',
    },
  }));
  return file;
}

function dependencies(overrides: Partial<UpgradeHelperDependencies> = {}): UpgradeHelperDependencies {
  return {
    waitForParentExit: async () => {},
    waitForRestartReceipt: async () => {},
    run: () => ({ status: 0 }),
    startApplication: async () => {},
    copyApplication: async (source, destination) => {
      if (process.platform === 'darwin') {
        await copyMacosApplication(source, destination);
        return;
      }
      fs.cpSync(source, destination, { recursive: true });
    },
    move: async (source, destination) => {
      fs.renameSync(source, destination);
    },
    ...overrides,
  };
}

test('helper 配置只接受受控暂存目录内的绝对完整安装包', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-config-'));
  const staging = path.join(directory, 'ota');
  const installer = path.join(staging, 'package.exe');
  fs.mkdirSync(staging);
  fs.writeFileSync(installer, 'installer');
  try {
    const configuration = createFullPackageUpgradeConfiguration({
      platform: 'windows',
      stagedPackage: installer,
      stagingDirectory: staging,
      electronPid: 100,
      executablePath: installer,
    });
    assert.equal(configuration.stagedPackage, installer);
    const outside = path.join(directory, 'outside.exe');
    fs.writeFileSync(outside, 'installer');
    assert.throws(
      () =>
        createFullPackageUpgradeConfiguration({
          platform: 'windows',
          stagedPackage: outside,
          stagingDirectory: staging,
          electronPid: 100,
          executablePath: installer,
        }),
      /受控暂存目录/,
    );
    const symbolic = path.join(staging, 'symbolic.exe');
    fs.symlinkSync(outside, symbolic);
    assert.throws(
      () =>
        createFullPackageUpgradeConfiguration({
          platform: 'windows',
          stagedPackage: symbolic,
          stagingDirectory: staging,
          electronPid: 100,
          executablePath: '/ignored',
        }),
      /普通文件/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows 使用暂存 cmd runner，避免安装器占用当前应用', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-runner-'));
  const staging = path.join(directory, 'ota');
  const application = path.join(directory, 'Jiying.exe');
  const installer = path.join(staging, 'package.exe');
  fs.mkdirSync(staging);
  fs.writeFileSync(application, 'current application');
  fs.writeFileSync(installer, 'installer');
  let resolveLaunched!: (value: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly environment: NodeJS.ProcessEnv;
  }) => void;
  const launched = new Promise<{
    readonly executable: string;
    readonly args: readonly string[];
    readonly environment: NodeJS.ProcessEnv;
  }>((resolve) => { resolveLaunched = resolve; });
  try {
    const prepared = await prepareFullPackageUpgrade({
      platform: 'windows',
      stagedPackage: installer,
      stagingDirectory: staging,
      electronPid: 100,
      executablePath: application,
    }, {
      launch: async (executable, args, environment) => {
        resolveLaunched({ executable, args, environment });
        return Object.freeze({}) as ChildProcess;
      },
    });
    const launch = await launched;
    assert.equal(launch.executable, 'cmd.exe');
    assert.deepEqual(launch.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.equal(launch.args[3], prepared.configuration);
    assert.equal(launch.environment.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(path.dirname(prepared.configuration), staging);
    assert.match(path.basename(prepared.configuration), /^\.upgrade-.+\.cmd$/);
    const runner = fs.readFileSync(prepared.configuration, 'utf8');
    assert.match(runner, /tasklist \/FI "PID eq %PARENT_PID%"/);
    assert.match(runner, /start "" \/wait "%INSTALLER%"/);
    assert.match(runner, /--dsh-forge-ota-staging-cleanup/);
    assert.match(runner, /set "APPLICATION=.*Jiying\.exe"/);
    assert.match(runner, /:wait_receipt/);
    assert.match(runner, /findstr \/C:token "%RECEIPT%"/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows runner 从 NSIS 关闭内建完成后启动，防止缺失回执参数的首个实例', () => {
  const packaging = fs.readFileSync(path.join(process.cwd(), 'scripts', 'package-desktop.ts'), 'utf8');
  assert.match(packaging, /config\.nsis = \{ runAfterFinish: false \}/);
});

test('Windows helper 先等待 PID，再运行 NSIS、启动新应用并等待就绪回执', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-windows-'));
  const installer = path.join(directory, 'package.exe');
  fs.writeFileSync(installer, 'installer');
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'windows',
    stagedPackage: installer,
    electronPid: 101,
  });
  const calls: string[] = [];
  try {
    const result = await runFullPackageUpgrade(
      file,
      dependencies({
        waitForParentExit: async (pid) => {
          calls.push(`wait:${pid}`);
        },
        run: (command, args) => {
          calls.push(`run:${command}:${args.join(',')}`);
          return { status: 0 };
        },
        startApplication: async (executable, args) => {
          calls.push(`start:${executable}:${args.join(',')}`);
        },
        waitForRestartReceipt: async (receipt) => {
          calls.push(`receipt:${receipt.receiptPath}:${receipt.token}`);
        },
      }),
    );
    assert.deepEqual(result, { success: true, code: null });
    assert.deepEqual(calls, [
      'wait:101',
      `run:${installer}:`,
      `start:${installer}:--dsh-forge-ota-restart-receipt,${path.join(directory, '.restart-test.restart.json')},--dsh-forge-ota-restart-token,00000000-0000-4000-8000-000000000001`,
      `receipt:${path.join(directory, '.restart-test.restart.json')}:00000000-0000-4000-8000-000000000001`,
    ]);
    assert.equal(fs.existsSync(installer), false);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows 安装器失败保留完整包', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-windows-fail-'));
  const installer = path.join(directory, 'package.exe');
  fs.writeFileSync(installer, 'installer');
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'windows',
    stagedPackage: installer,
    electronPid: 101,
  });
  try {
    const result = await runFullPackageUpgrade(file, dependencies({ run: () => ({ status: 1 }) }));
    assert.deepEqual(result, { success: false, code: 'OTA_INSTALL_FAILED' });
    assert.equal(fs.existsSync(installer), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS helper 替换唯一 .app、启动、卸载 DMG 后删除完整包', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-macos-install-'));
  const application = path.join(directory, 'Jiying.app');
  const installer = path.join(directory, 'package.dmg');
  fs.mkdirSync(path.join(application, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(application, 'Contents', 'version.txt'), 'old');
  fs.writeFileSync(installer, 'dmg');
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'macos',
    stagedPackage: installer,
    electronPid: 102,
    macosApplication: application,
  });
  const calls: string[] = [];
  try {
    const result = await runFullPackageUpgrade(
      file,
      dependencies({
        waitForParentExit: async (pid) => {
          calls.push(`wait:${pid}`);
        },
        run: (command, args) => {
          calls.push(`run:${command}:${args[0] || ''}`);
          if (command === 'hdiutil' && args[0] === 'attach') {
            const mountPoint = args.at(-1);
            if (!mountPoint) throw new Error('缺少 DMG 挂载点');
            fs.mkdirSync(path.join(mountPoint, 'Jiying.app', 'Contents'), { recursive: true });
            fs.writeFileSync(path.join(mountPoint, 'Jiying.app', 'Contents', 'version.txt'), 'new');
          }
          return { status: 0 };
        },
      }),
    );
    assert.deepEqual(result, { success: true, code: null });
    assert.deepEqual(calls, [
      'wait:102',
      'run:hdiutil:attach',
      'run:codesign:--verify',
      'run:spctl:--assess',
      'run:open:-n',
      'run:hdiutil:detach',
    ]);
    assert.equal(fs.readFileSync(path.join(application, 'Contents', 'version.txt'), 'utf8'), 'new');
    assert.equal(fs.existsSync(installer), false);
    assert.equal(fs.readdirSync(directory).some((name) => name.includes('dsh-forge-backup')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS bundle 复制保留 Electron Framework 的相对符号链接', { skip: process.platform !== 'darwin' }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-macos-ditto-'));
  const source = path.join(directory, 'Source.app');
  const destination = path.join(directory, 'Destination.app');
  const framework = path.join(source, 'Contents', 'Frameworks', 'Electron Framework.framework');
  try {
    fs.mkdirSync(path.join(framework, 'Versions', 'A'), { recursive: true });
    fs.writeFileSync(path.join(framework, 'Versions', 'A', 'Electron Framework'), 'framework');
    fs.symlinkSync('A', path.join(framework, 'Versions', 'Current'));
    fs.symlinkSync('Versions/Current/Electron Framework', path.join(framework, 'Electron Framework'));
    await copyMacosApplication(source, destination);
    assert.equal(
      fs.readlinkSync(path.join(destination, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')),
      'Versions/Current/Electron Framework',
    );
    assert.equal(
      fs.existsSync(path.join(destination, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')),
      true,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS 新 bundle 验证失败时不覆盖旧应用且保留完整包', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-macos-verify-fail-'));
  const application = path.join(directory, 'Jiying.app');
  const installer = path.join(directory, 'package.dmg');
  fs.mkdirSync(path.join(application, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(application, 'Contents', 'version.txt'), 'old');
  fs.writeFileSync(installer, 'dmg');
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'macos',
    stagedPackage: installer,
    electronPid: 102,
    macosApplication: application,
  });
  try {
    const result = await runFullPackageUpgrade(
      file,
      dependencies({
        run: (command, args) => {
          if (command === 'hdiutil' && args[0] === 'attach') {
            const mountPoint = args.at(-1);
            if (!mountPoint) throw new Error('缺少 DMG 挂载点');
            fs.mkdirSync(path.join(mountPoint, 'Jiying.app', 'Contents'), { recursive: true });
            fs.writeFileSync(path.join(mountPoint, 'Jiying.app', 'Contents', 'version.txt'), 'new');
          }
          return { status: command === 'codesign' ? 1 : 0 };
        },
      }),
    );
    assert.deepEqual(result, { success: false, code: 'OTA_INSTALL_FAILED' });
    assert.equal(fs.readFileSync(path.join(application, 'Contents', 'version.txt'), 'utf8'), 'old');
    assert.equal(fs.existsSync(installer), true);
    assert.equal(fs.readdirSync(directory).some((name) => name.includes('dsh-forge-backup')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS 新应用启动命令失败时恢复旧应用并保留完整包', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-macos-launch-fail-'));
  const application = path.join(directory, 'Jiying.app');
  const installer = path.join(directory, 'package.dmg');
  fs.mkdirSync(path.join(application, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(application, 'Contents', 'version.txt'), 'old');
  fs.writeFileSync(installer, 'dmg');
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'macos',
    stagedPackage: installer,
    electronPid: 102,
    macosApplication: application,
  });
  try {
    const result = await runFullPackageUpgrade(
      file,
      dependencies({
        run: (command, args) => {
          if (command === 'hdiutil' && args[0] === 'attach') {
            const mountPoint = args.at(-1);
            if (!mountPoint) throw new Error('缺少 DMG 挂载点');
            fs.mkdirSync(path.join(mountPoint, 'Jiying.app', 'Contents'), { recursive: true });
            fs.writeFileSync(path.join(mountPoint, 'Jiying.app', 'Contents', 'version.txt'), 'new');
          }
          return { status: command === 'open' ? 1 : 0 };
        },
      }),
    );
    assert.deepEqual(result, { success: false, code: 'OTA_INSTALL_FAILED' });
    assert.equal(fs.readFileSync(path.join(application, 'Contents', 'version.txt'), 'utf8'), 'old');
    assert.equal(fs.existsSync(installer), true);
    assert.equal(fs.readdirSync(directory).some((name) => name.includes('dsh-forge-backup')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS 新应用未提交就绪回执时恢复旧应用并保留完整包', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-macos-receipt-fail-'));
  const application = path.join(directory, 'Jiying.app');
  const installer = path.join(directory, 'package.dmg');
  fs.mkdirSync(path.join(application, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(application, 'Contents', 'version.txt'), 'old');
  fs.writeFileSync(installer, 'dmg');
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'macos',
    stagedPackage: installer,
    electronPid: 102,
    macosApplication: application,
  });
  try {
    const result = await runFullPackageUpgrade(
      file,
      dependencies({
        run: (command, args) => {
          if (command === 'hdiutil' && args[0] === 'attach') {
            const mountPoint = args.at(-1);
            if (!mountPoint) throw new Error('缺少 DMG 挂载点');
            fs.mkdirSync(path.join(mountPoint, 'Jiying.app', 'Contents'), { recursive: true });
            fs.writeFileSync(path.join(mountPoint, 'Jiying.app', 'Contents', 'version.txt'), 'new');
          }
          return { status: 0 };
        },
        waitForRestartReceipt: async () => Promise.reject(new Error('新版应用未就绪')),
      }),
    );
    assert.deepEqual(result, { success: false, code: 'OTA_INSTALL_FAILED' });
    assert.equal(fs.readFileSync(path.join(application, 'Contents', 'version.txt'), 'utf8'), 'old');
    assert.equal(fs.existsSync(installer), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS 新应用提交就绪回执后忽略卷卸载和清理失败', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-macos-cleanup-'));
  const application = path.join(directory, 'Jiying.app');
  const installer = path.join(directory, 'package.dmg');
  fs.mkdirSync(path.join(application, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(application, 'Contents', 'version.txt'), 'old');
  fs.writeFileSync(installer, 'dmg');
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'macos',
    stagedPackage: installer,
    electronPid: 102,
    macosApplication: application,
  });
  try {
    const result = await runFullPackageUpgrade(
      file,
      dependencies({
        run: (command, args) => {
          if (command === 'hdiutil' && args[0] === 'attach') {
            const mountPoint = args.at(-1);
            if (!mountPoint) throw new Error('缺少 DMG 挂载点');
            fs.mkdirSync(path.join(mountPoint, 'Jiying.app', 'Contents'), { recursive: true });
            fs.writeFileSync(path.join(mountPoint, 'Jiying.app', 'Contents', 'version.txt'), 'new');
          }
          return { status: command === 'hdiutil' && args[0] === 'detach' ? 1 : 0 };
        },
      }),
    );
    assert.deepEqual(result, { success: true, code: null });
    assert.equal(fs.readFileSync(path.join(application, 'Contents', 'version.txt'), 'utf8'), 'new');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Ubuntu AppImage 原子替换后启动成功才删除备份和完整包', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-ubuntu-'));
  const appImage = path.join(directory, 'Jiying.AppImage');
  const installer = path.join(directory, 'package.AppImage');
  fs.writeFileSync(appImage, 'old');
  fs.writeFileSync(installer, 'new');
  fs.chmodSync(appImage, 0o700);
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'ubuntu',
    stagedPackage: installer,
    electronPid: 102,
    appImagePath: appImage,
  });
  try {
    const result = await runFullPackageUpgrade(file, dependencies());
    assert.deepEqual(result, { success: true, code: null });
    assert.equal(fs.readFileSync(appImage, 'utf8'), 'new');
    assert.equal((fs.statSync(appImage).mode & 0o111) !== 0, true);
    assert.equal(fs.existsSync(installer), false);
    assert.equal(fs.readdirSync(directory).some((name) => name.includes('dsh-forge-backup')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Ubuntu 新 AppImage 启动失败会恢复旧版本并保留完整包', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-ubuntu-rollback-'));
  const appImage = path.join(directory, 'Jiying.AppImage');
  const installer = path.join(directory, 'package.AppImage');
  fs.writeFileSync(appImage, 'old');
  fs.writeFileSync(installer, 'new');
  fs.chmodSync(appImage, 0o700);
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'ubuntu',
    stagedPackage: installer,
    electronPid: 103,
    appImagePath: appImage,
  });
  try {
    const result = await runFullPackageUpgrade(
      file,
      dependencies({ startApplication: async () => Promise.reject(new Error('启动失败')) }),
    );
    assert.deepEqual(result, { success: false, code: 'OTA_INSTALL_FAILED' });
    assert.equal(fs.readFileSync(appImage, 'utf8'), 'old');
    assert.equal(fs.existsSync(installer), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Ubuntu 第二次原子重命名失败时恢复旧版本并保留完整包', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-ubuntu-rename-rollback-'));
  const appImage = path.join(directory, 'Jiying.AppImage');
  const installer = path.join(directory, 'package.AppImage');
  fs.writeFileSync(appImage, 'old');
  fs.writeFileSync(installer, 'new');
  fs.chmodSync(appImage, 0o700);
  const file = configurationFile(directory, {
    schema: 'dsh-forge/full-package-upgrade@1',
    platform: 'ubuntu',
    stagedPackage: installer,
    electronPid: 104,
    appImagePath: appImage,
  });
  let moves = 0;
  try {
    const result = await runFullPackageUpgrade(
      file,
      dependencies({
        move: async (source, destination) => {
          moves += 1;
          if (moves === 2) throw new Error('模拟第二次重命名失败');
          fs.renameSync(source, destination);
        },
      }),
    );
    assert.deepEqual(result, { success: false, code: 'OTA_INSTALL_FAILED' });
    assert.equal(fs.readFileSync(appImage, 'utf8'), 'old');
    assert.equal(fs.existsSync(installer), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('macOS 配置从当前 .app 内的可执行文件定位安装目标', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-helper-macos-'));
  const staging = path.join(directory, 'ota');
  const application = path.join(directory, 'Jiying.app');
  const executable = path.join(application, 'Contents', 'MacOS', 'Jiying');
  const dmg = path.join(staging, 'package.dmg');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(staging);
  fs.writeFileSync(executable, 'binary');
  fs.writeFileSync(dmg, 'dmg');
  try {
    const configuration = createFullPackageUpgradeConfiguration({
      platform: 'macos',
      stagedPackage: dmg,
      stagingDirectory: staging,
      electronPid: 105,
      executablePath: executable,
    });
    assert.equal(configuration.macosApplication, application);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
