/**
 * Pin Command
 *
 * Show or change the default model and effort for new sessions.
 *
 * Usage:
 *   ccs pin                        Show the default model and its effort
 *   ccs pin model <id>             Set the default model
 *
 * Writes one key of ~/.claude/settings.json through its link and never runs git.
 */

import * as fs from 'fs';
import { getClaudeSettingsPath } from '../utils/claude-config-path';
import { fail, info, initUI, ok } from '../utils/ui';
import { formatDisplayPath, parseSettingsObject } from './persist-command/secure-file';

const ONE_MILLION_SUFFIX = '[1m]';

type Settings = Record<string, unknown>;

type PinRequest = { kind: 'show' } | { kind: 'model'; id: string };

function parsePinArgs(args: string[]): PinRequest | null {
  if (args.length === 0) return { kind: 'show' };
  const [form, first] = args;
  if (args.some((arg) => arg === '')) return null;
  if (form === 'model' && args.length === 2) return { kind: 'model', id: first };
  return null;
}

function printUsage(): void {
  console.error('Usage:');
  console.error('  ccs pin                        Show the default model and its effort');
  console.error('  ccs pin model <id>             Set the default model');
}

function stripOneMillionSuffix(modelId: string): string {
  return modelId.endsWith(ONE_MILLION_SUFFIX)
    ? modelId.slice(0, -ONE_MILLION_SUFFIX.length)
    : modelId;
}

function isRecord(value: unknown): value is Settings {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDefaultModel(settings: Settings): string | undefined {
  return typeof settings.model === 'string' && settings.model !== '' ? settings.model : undefined;
}

function readEffort(settings: Settings, modelId: string): string | undefined {
  const modelSettings = settings.modelSettings;
  if (!isRecord(modelSettings)) return undefined;
  const entry = modelSettings[modelId];
  if (!isRecord(entry)) return undefined;
  return typeof entry.effortLevel === 'string' ? entry.effortLevel : undefined;
}

function readSettings(): Settings {
  return parseSettingsObject(fs.readFileSync(getClaudeSettingsPath(), 'utf8'), 'settings.json');
}

/** Replace the tracked file behind the settings link, keeping the link and the file mode. */
function writeSettings(settings: Settings): void {
  const target = fs.realpathSync(getClaudeSettingsPath());
  const mode = fs.statSync(target).mode & 0o777;
  const tempPath = `${target}.ccs-pin-${process.pid}-${Date.now()}`;
  try {
    const descriptor = fs.openSync(tempPath, 'wx', mode);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(tempPath, target);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

async function runCopyBack(): Promise<void> {
  const SharedManager = (await import('../management/shared-manager')).default;
  new SharedManager().ensureSharedDirectories();
}

function showDefault(settings: Settings): number {
  const model = readDefaultModel(settings);
  const effort = model ? readEffort(settings, stripOneMillionSuffix(model)) : undefined;
  console.log(`Default model:  ${model ?? 'not set'}`);
  console.log(`Default effort: ${effort ?? 'not set'}`);
  return 0;
}

async function pinModel(settings: Settings, id: string): Promise<number> {
  const current = readDefaultModel(settings);
  if (current === id) {
    console.log(info(`Default model is already ${id}`));
    return 0;
  }

  await runCopyBack();
  const fresh = readSettings();
  fresh.model = id;
  writeSettings(fresh);
  console.log(ok(`Default model: ${current ?? 'not set'} -> ${id}`));
  console.log(
    info(`New sessions start on it. Written to ${formatDisplayPath(getClaudeSettingsPath())}`)
  );
  return 0;
}

/** Run `ccs pin` and return its exit code. */
export async function runPinCommand(args: string[]): Promise<number> {
  const request = parsePinArgs(args);
  if (!request) {
    printUsage();
    return 1;
  }

  let settings: Settings;
  try {
    settings = readSettings();
  } catch (error) {
    console.error(
      fail(`Cannot read ${formatDisplayPath(getClaudeSettingsPath())}: ${(error as Error).message}`)
    );
    return 1;
  }

  try {
    if (request.kind === 'show') return showDefault(settings);
    return await pinModel(settings, request.id);
  } catch (error) {
    console.error(fail(`Cannot write settings: ${(error as Error).message}`));
    return 1;
  }
}

export async function handlePinCommand(args: string[]): Promise<number> {
  await initUI();
  return runPinCommand(args);
}
