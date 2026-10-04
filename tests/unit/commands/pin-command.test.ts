import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleHelpCommand } from '../../../src/commands/help-command';
import { runPinCommand } from '../../../src/commands/pin-command';
import { isReservedName, validateProfileName } from '../../../src/config/reserved-names';

describe('ccs pin', () => {
  let tempRoot = '';
  let originalCcsHome: string | undefined;
  let originalCcsDir: string | undefined;
  let originalClaudeConfigDir: string | undefined;
  let logLines: string[] = [];
  let errorLines: string[] = [];

  const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');
  const claudeSettingsPath = () => path.join(tempRoot, '.claude', 'settings.json');
  const trackedPath = () => path.join(tempRoot, 'repo', 'settings.json');
  const sharedSettingsPath = () => path.join(tempRoot, '.ccs', 'shared', 'settings.json');
  const readTracked = () => fs.readFileSync(trackedPath(), 'utf8');
  const readTrackedJson = () => JSON.parse(readTracked()) as Record<string, unknown>;

  function writeTracked(value: unknown): void {
    fs.mkdirSync(path.dirname(trackedPath()), { recursive: true });
    fs.mkdirSync(path.dirname(claudeSettingsPath()), { recursive: true });
    fs.writeFileSync(trackedPath(), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.rmSync(claudeSettingsPath(), { force: true });
    fs.symlinkSync(trackedPath(), claudeSettingsPath());
  }

  function changedLines(before: string, after: string): string[] {
    const beforeLines = before.split('\n');
    return after.split('\n').filter((line, index) => line !== beforeLines[index]);
  }

  async function pin(...args: string[]): Promise<number> {
    return runPinCommand(args);
  }

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-pin-test-'));
    originalCcsHome = process.env.CCS_HOME;
    originalCcsDir = process.env.CCS_DIR;
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    spyOn(os, 'homedir').mockReturnValue(tempRoot);
    process.env.CCS_HOME = tempRoot;
    delete process.env.CCS_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;

    logLines = [];
    errorLines = [];
    spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logLines.push(stripAnsi(args.join(' ')));
    });
    spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLines.push(stripAnsi(args.join(' ')));
    });
  });

  afterEach(() => {
    mock.restore();
    if (originalCcsHome !== undefined) process.env.CCS_HOME = originalCcsHome;
    else delete process.env.CCS_HOME;
    if (originalCcsDir !== undefined) process.env.CCS_DIR = originalCcsDir;
    else delete process.env.CCS_DIR;
    if (originalClaudeConfigDir !== undefined)
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
    else delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('showing the default', () => {
    it('prints the model and its effort and writes nothing', async () => {
      writeTracked({
        model: 'claude-fable-5-1',
        modelSettings: { 'claude-fable-5-1': { effortLevel: 'high' } },
      });
      const before = readTracked();

      expect(await pin()).toBe(0);

      expect(logLines).toEqual(['Default model:  claude-fable-5-1', 'Default effort: high']);
      expect(readTracked()).toBe(before);
    });

    it('prints not set for both when there is no model key', async () => {
      writeTracked({ theme: 'dark' });

      expect(await pin()).toBe(0);

      expect(logLines).toEqual(['Default model:  not set', 'Default effort: not set']);
    });

    it('prints not set for the effort when none is saved for the model', async () => {
      writeTracked({ model: 'claude-opus-5-5', effortLevel: 'xhigh' });

      expect(await pin()).toBe(0);

      expect(logLines).toEqual(['Default model:  claude-opus-5-5', 'Default effort: not set']);
    });

    it('fails with the [X] mark when the settings file is missing', async () => {
      expect(await pin()).toBe(1);

      expect(errorLines).toHaveLength(1);
      expect(errorLines[0].startsWith('[X] Cannot read')).toBe(true);
    });
  });

  describe('model', () => {
    it('changes one line, keeps the link, and prints the old and new value', async () => {
      writeTracked({ model: 'claude-fable-5-1', theme: 'dark' });
      const before = readTracked();

      expect(await pin('model', 'claude-sonnet-5-5')).toBe(0);

      const after = readTracked();
      expect(changedLines(before, after)).toEqual(['  "model": "claude-sonnet-5-5",']);
      expect(after.endsWith('}\n')).toBe(true);
      expect(fs.lstatSync(claudeSettingsPath()).isSymbolicLink()).toBe(true);
      expect(logLines).toEqual([
        '[OK] Default model: claude-fable-5-1 -> claude-sonnet-5-5',
        '[i] New sessions start on it. Written to ~/.claude/settings.json',
      ]);
    });

    it('prints not set as the old value when the file has no model key', async () => {
      writeTracked({ theme: 'dark' });

      expect(await pin('model', 'claude-sonnet-5-5')).toBe(0);

      expect(readTrackedJson()).toEqual({ theme: 'dark', model: 'claude-sonnet-5-5' });
      expect(logLines[0]).toBe('[OK] Default model: not set -> claude-sonnet-5-5');
    });

    it('accepts an alias exactly as typed', async () => {
      writeTracked({ model: 'claude-fable-5-1' });

      expect(await pin('model', 'sonnet[1m]')).toBe(0);

      expect(readTrackedJson().model).toBe('sonnet[1m]');
    });

    it('writes nothing when the model already is the value', async () => {
      writeTracked({ model: 'claude-fable-5-1' });
      const before = readTracked();

      expect(await pin('model', 'claude-fable-5-1')).toBe(0);

      expect(readTracked()).toBe(before);
      expect(logLines).toEqual(['[i] Default model is already claude-fable-5-1']);
    });

    it('handles a waiting saved file before the write', async () => {
      writeTracked({ model: 'claude-fable-5-1', alwaysThinkingEnabled: true });
      fs.mkdirSync(path.dirname(sharedSettingsPath()), { recursive: true });
      fs.writeFileSync(
        sharedSettingsPath(),
        `${JSON.stringify({ model: 'sonnet', alwaysThinkingEnabled: false }, null, 2)}\n`,
        'utf8'
      );
      const later = new Date(fs.statSync(trackedPath()).mtimeMs + 2_000);
      fs.utimesSync(sharedSettingsPath(), later, later);

      expect(await pin('model', 'claude-sonnet-5-5')).toBe(0);

      expect(readTrackedJson()).toEqual({
        model: 'claude-sonnet-5-5',
        alwaysThinkingEnabled: false,
      });
      expect(fs.lstatSync(sharedSettingsPath()).isSymbolicLink()).toBe(true);
      expect(fs.lstatSync(claudeSettingsPath()).isSymbolicLink()).toBe(true);
    });
  });

  describe('argument shapes', () => {
    const shapes = [
      ['model'],
      ['effort'],
      ['model', 'a', 'b'],
      ['effort', 'high', 'a', 'b'],
      ['sync'],
      ['model', ''],
    ];

    for (const shape of shapes) {
      it(`prints the usage and exits non-zero for ccs pin ${JSON.stringify(shape)}`, async () => {
        writeTracked({ model: 'claude-fable-5-1' });
        const before = readTracked();

        expect(await pin(...shape)).toBe(1);

        expect(errorLines[0]).toBe('Usage:');
        expect(readTracked()).toBe(before);
      });
    }
  });

  describe('registration', () => {
    it('reserves the name pin', () => {
      expect(isReservedName('pin')).toBe(true);
      expect(() => validateProfileName('pin')).toThrow();
    });

    it('lists pin in the root help', async () => {
      const lines: string[] = [];
      await handleHelpCommand((line) => lines.push(stripAnsi(line)));

      expect(
        lines.some((line) =>
          /^\s+pin\s+Set the default model and effort for new sessions$/.test(line)
        )
      ).toBe(true);
    });
  });
});
