import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import ProfileRegistry from '../../src/auth/profile-registry';
import InstanceManager from '../../src/management/instance-manager';
import { handleCreate } from '../../src/auth/commands/create-command';
import * as claudeDetector from '../../src/utils/claude-detector';

type ExitListener = (code: number | null) => Promise<void> | void;

class ExitSignal extends Error {}

async function untilExit(action: () => Promise<void> | void | undefined): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
}

describe('auth create --login-only and --no-login', () => {
  let tempRoot = '';
  let instancePath = '';
  let originalCcsHome: string | undefined;
  let originalUnifiedMode: string | undefined;
  let exitCodes: number[] = [];
  let exitListener: ExitListener | undefined;
  let restores: Array<{ mockRestore: () => void }> = [];

  const ctx = () => ({
    registry: new ProfileRegistry(),
    instanceMgr: new InstanceManager(),
    version: 'test',
  });

  const fakeClaude = (info: ReturnType<typeof claudeDetector.getClaudeCliInfo>) => {
    restores.push(spyOn(claudeDetector, 'getClaudeCliInfo').mockReturnValue(info));
    const child = {
      on: (event: string, listener: ExitListener) => {
        if (event === 'exit') exitListener = listener;
        return child;
      },
    } as unknown as ReturnType<typeof childProcess.spawn>;
    const spawnSpy = spyOn(childProcess, 'spawn').mockReturnValue(child);
    restores.push(spawnSpy);
    return spawnSpy;
  };

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-auth-create-login-'));
    instancePath = path.join(tempRoot, '.ccs', 'instances', 'work');
    originalCcsHome = process.env.CCS_HOME;
    originalUnifiedMode = process.env.CCS_UNIFIED_CONFIG;
    process.env.CCS_HOME = tempRoot;
    process.env.CCS_UNIFIED_CONFIG = '1';

    exitCodes = [];
    exitListener = undefined;
    restores = [
      spyOn(process, 'exit').mockImplementation(((code?: number) => {
        exitCodes.push(code ?? 0);
        throw new ExitSignal();
      }) as typeof process.exit),
      spyOn(InstanceManager.prototype, 'ensureInstance').mockResolvedValue(instancePath),
      spyOn(InstanceManager.prototype, 'deleteInstance').mockResolvedValue(undefined),
      spyOn(console, 'log').mockImplementation(() => {}),
      spyOn(console, 'error').mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    for (const spy of restores.reverse()) spy.mockRestore();

    if (originalCcsHome !== undefined) process.env.CCS_HOME = originalCcsHome;
    else delete process.env.CCS_HOME;
    if (originalUnifiedMode !== undefined) process.env.CCS_UNIFIED_CONFIG = originalUnifiedMode;
    else delete process.env.CCS_UNIFIED_CONFIG;

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('--login-only runs claude auth login in the instance and keeps the account on exit 0', async () => {
    const spawnSpy = fakeClaude({ path: '/usr/bin/claude', isWindows: false, needsShell: false });

    await handleCreate(ctx(), ['work', '--login-only']);

    const [command, args, options] = spawnSpy.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    expect(command).toBe('/usr/bin/claude');
    expect(args).toEqual(['auth', 'login']);
    expect(options.env.CLAUDE_CONFIG_DIR).toBe(instancePath);

    await untilExit(() => exitListener?.(0));
    expect(exitCodes).toEqual([0]);
    expect(new ProfileRegistry().hasAccountUnified('work')).toBe(true);
  });

  it('--login-only rolls the account back when the login exits non-zero', async () => {
    fakeClaude({ path: '/usr/bin/claude', isWindows: false, needsShell: false });

    await handleCreate(ctx(), ['work', '--login-only']);
    await untilExit(() => exitListener?.(1));

    expect(exitCodes).toEqual([4]);
    expect(new ProfileRegistry().hasAccountUnified('work')).toBe(false);
  });

  it('--no-login registers the account and starts no claude, even when claude is not installed', async () => {
    const spawnSpy = fakeClaude(null);

    await handleCreate(ctx(), ['work', '--no-login']);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(InstanceManager.prototype.ensureInstance).toHaveBeenCalled();
    expect(exitCodes).toEqual([]);
    expect(new ProfileRegistry().hasAccountUnified('work')).toBe(true);
  });

  it('rejects --login-only together with --no-login', async () => {
    const spawnSpy = fakeClaude({ path: '/usr/bin/claude', isWindows: false, needsShell: false });

    await untilExit(() => handleCreate(ctx(), ['work', '--login-only', '--no-login']));

    expect(exitCodes).toEqual([7]);
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});
