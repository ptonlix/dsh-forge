/** 平台升级 helper 的内部路径、退出顺序、清理和 Ubuntu 回滚测试。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  copyMacosApplication,
  createFullPackageUpgradeConfiguration,
  runFullPackageUpgrade,
  type UpgradeHelperDependencies,
} from '../apps/desktop/platform/full-package-upgrade.ts';

function configurationFile(directory: string, value: Record<string, unknown>): string {
  const file = path.join(directory, 'helper.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function dependencies(overrides: Partial<UpgradeHelperDependencies> = {}): UpgradeHelperDependencies {
  return {
    waitForParentExit: async () => {},
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
      executablePath: '/ignored',
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
          executablePath: '/ignored',
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

test('Windows helper 先等待 PID，再以受控参数运行 NSIS，成功后删除完整包', async () => {
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
      }),
    );
    assert.deepEqual(result, { success: true, code: null });
    assert.deepEqual(calls, ['wait:101', `run:${installer}:`]);
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
