/**
 * Pin Command
 *
 * Show or change the default model and effort for new sessions.
 *
 * Usage:
 *   ccs pin                        Show the default model and its effort
 *   ccs pin model <id>             Set the default model
 *   ccs pin effort <level>         Set the effort of the default model
 *   ccs pin effort <level> <id>    Set the effort of another model
 *
 * Writes one key of ~/.claude/settings.json through its link and never runs git.
 */

import * as fs from 'fs';
import { getClaudeSettingsPath } from '../utils/claude-config-path';
import { fail, info, initUI, ok } from '../utils/ui';
import { formatDisplayPath, parseSettingsObject } from './persist-command/secure-file';

const EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh'];
const MODEL_ALIASES: readonly string[] = [
  'default',
  'best',
  'fable',
  'sonnet',
  'opus',
  'haiku',
  'opusplan',
];
const ONE_MILLION_SUFFIX = '[1m]';
const EXAMPLE_MODEL_ID = 'claude-opus-5-5';

type Settings = Record<string, unknown>;

type PinRequest =
  | { kind: 'show' }
  | { kind: 'model'; id: string }
  | { kind: 'effort'; level: string; id?: string };

function parsePinArgs(args: string[]): PinRequest | null {
  if (args.length === 0) return { kind: 'show' };
  const [form, first, second] = args;
  if (args.some((arg) => arg === '')) return null;
  if (form === 'model' && args.length === 2) return { kind: 'model', id: first };
  if (form === 'effort' && (args.length === 2 || args.length === 3)) {
    return { kind: 'effort', level: first, id: second };
  }
  return null;
}

function printUsage(): void {
  console.error('Usage:');
  console.error('  ccs pin                        Show the default model and its effort');
  console.error('  ccs pin model <id>             Set the default model');
  console.error('  ccs pin effort <level>         Set the effort of the default model');
  console.error('  ccs pin effort <level> <id>    Set the effort of another model');
  console.error('');
  console.error(`Levels: ${EFFORT_LEVELS.join(', ')}`);
}

function stripOneMillionSuffix(modelId: string): string {
  return modelId.endsWith(ONE_MILLION_SUFFIX)
    ? modelId.slice(0, -ONE_MILLION_SUFFIX.length)
    : modelId;
}

function isAlias(modelId: string): boolean {
  return MODEL_ALIASES.includes(stripOneMillionSuffix(modelId).toLowerCase());
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

async function pinEffort(
  settings: Settings,
  level: string,
  explicitId: string | undefined
): Promise<number> {
  let modelId: string;
  if (explicitId !== undefined) {
    modelId = stripOneMillionSuffix(explicitId);
  } else {
    const defaultModel = readDefaultModel(settings);
    if (!defaultModel) {
      console.error(fail(`No default model is set. Name the model: ccs pin effort ${level} <id>`));
      return 1;
    }
    if (isAlias(defaultModel)) {
      console.error(
        fail(
          `The default model ${defaultModel} is an alias. Name the model: ccs pin effort ${level} <id>`
        )
      );
      return 1;
    }
    modelId = stripOneMillionSuffix(defaultModel);
  }

  if (settings.modelSettings !== undefined && !isRecord(settings.modelSettings)) {
    console.error(fail('modelSettings in settings.json is not an object'));
    return 1;
  }

  const current = readEffort(settings, modelId);
  if (current === level) {
    console.log(info(`Effort for ${modelId} is already ${level}`));
    return 0;
  }

  await runCopyBack();
  const fresh = readSettings();
  const modelSettings = isRecord(fresh.modelSettings) ? fresh.modelSettings : {};
  const existingEntry = modelSettings[modelId];
  const entry = isRecord(existingEntry) ? existingEntry : {};
  modelSettings[modelId] = { ...entry, effortLevel: level };
  fresh.modelSettings = modelSettings;
  writeSettings(fresh);
  console.log(ok(`Effort for ${modelId}: ${current ?? 'not set'} -> ${level}`));
  return 0;
}

/** Run `ccs pin` and return its exit code. */
export async function runPinCommand(args: string[]): Promise<number> {
  const request = parsePinArgs(args);
  if (!request) {
    printUsage();
    return 1;
  }

  if (request.kind === 'effort' && !EFFORT_LEVELS.includes(request.level)) {
    console.error(
      fail(`${request.level} cannot be saved as a default. Use low, medium, high or xhigh`)
    );
    return 1;
  }

  if (request.kind === 'effort' && request.id !== undefined && isAlias(request.id)) {
    console.error(
      fail(`${request.id} is an alias. Use the full model id, for example ${EXAMPLE_MODEL_ID}`)
    );
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
    if (request.kind === 'model') return await pinModel(settings, request.id);
    return await pinEffort(settings, request.level, request.id);
  } catch (error) {
    console.error(fail(`Cannot write settings: ${(error as Error).message}`));
    return 1;
  }
}

export async function handlePinCommand(args: string[]): Promise<number> {
  await initUI();
  return runPinCommand(args);
}
