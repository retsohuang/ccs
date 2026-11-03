/**
 * SharedManager - installed_plugins.json record merge for the diverged-file
 * adopter. Reads the home's base snapshot, merges the home's copy into the
 * canonical registry and describes the outcome; publishing stays with the
 * adopter.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isDeepStrictEqual } from 'util';

import { mergePluginRegistries, type PluginRecordRef } from './plugin-registry-merge';

export const INSTALLED_PLUGINS_FILE = 'installed_plugins.json';

export type InstalledPluginsMerge =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** Merged registry bytes, or the canonical bytes when nothing changed. */
      content: Buffer;
      changed: boolean;
      summary: string;
    };

export function baseSnapshotPath(divergedPath: string): string {
  return `${divergedPath}.ccs-base`;
}

function readBaseSnapshot(divergedPath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(baseSnapshotPath(divergedPath), 'utf8'));
  } catch {
    return undefined;
  }
}

function describeRecord(verb: string, ref: PluginRecordRef): string {
  const where = ref.projectPath ? `${ref.scope ?? 'no scope'}, ${ref.projectPath}` : ref.scope;
  return `${verb} ${ref.pluginId} (${where ?? 'no scope'})`;
}

export function mergeInstalledPlugins(
  divergedPath: string,
  canonicalContent: Buffer,
  divergedContent: Buffer
): InstalledPluginsMerge {
  let canonical: unknown;
  let copy: unknown;
  try {
    canonical = JSON.parse(canonicalContent.toString('utf8'));
    copy = JSON.parse(divergedContent.toString('utf8'));
  } catch {
    return { ok: false, reason: 'a registry is not valid JSON' };
  }

  const merged = mergePluginRegistries(readBaseSnapshot(divergedPath), canonical, copy);
  if (!merged.ok) return merged;

  if (isDeepStrictEqual(merged.registry, canonical)) {
    return { ok: true, content: canonicalContent, changed: false, summary: '' };
  }

  const home = path.basename(path.dirname(path.dirname(divergedPath)));
  const records = [
    ...merged.updated.map((ref) => describeRecord('updated', ref)),
    ...merged.added.map((ref) => describeRecord('added', ref)),
    ...merged.dropped.map((ref) => describeRecord('dropped', ref)),
  ];
  return {
    ok: true,
    content: Buffer.from(JSON.stringify(merged.registry, null, 2), 'utf8'),
    changed: true,
    summary: `Merged ${INSTALLED_PLUGINS_FILE} from ${home}: ${records.join('; ')}`,
  };
}
