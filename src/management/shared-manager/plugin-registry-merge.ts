/**
 * SharedManager - record merge for installed_plugins.json.
 *
 * Pure function: combines a home's base snapshot (or none), the canonical
 * registry and the home's copy into one registry. It never touches the
 * filesystem, so the adopter owns reading, publishing and reporting.
 */

type JsonObject = Record<string, unknown>;

export interface PluginRecordRef {
  pluginId: string;
  scope: string | undefined;
  projectPath: string | undefined;
}

export type PluginRegistryMergeResult =
  | {
      ok: true;
      registry: JsonObject;
      /** Records whose canonical content was replaced by the copy's record. */
      updated: PluginRecordRef[];
      /** Records the copy holds that the canonical file did not. */
      added: PluginRecordRef[];
      /** Records the canonical file held that the merge removed. */
      dropped: PluginRecordRef[];
    }
  | { ok: false; reason: string };

interface ParsedRegistry {
  registry: JsonObject;
  plugins: Map<string, JsonObject[]>;
}

type ParseOutcome = { ok: true; parsed: ParsedRegistry } | { ok: false; reason: string };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function refOf(pluginId: string, record: JsonObject): PluginRecordRef {
  return {
    pluginId,
    scope: stringOrUndefined(record.scope),
    projectPath: stringOrUndefined(record.projectPath),
  };
}

function recordKey(pluginId: string, record: JsonObject): string {
  const ref = refOf(pluginId, record);
  return JSON.stringify([ref.pluginId, ref.scope ?? null, ref.projectPath ?? null]);
}

function describeKey(pluginId: string, record: JsonObject): string {
  const ref = refOf(pluginId, record);
  return `${pluginId} (${ref.scope ?? 'no scope'}${ref.projectPath ? `, ${ref.projectPath}` : ''})`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function sameRecord(a: JsonObject, b: JsonObject): boolean {
  return stableStringify(a) === stableStringify(b);
}

function parseRegistry(input: unknown, label: string): ParseOutcome {
  if (!isObject(input) || !isObject(input.plugins)) {
    return { ok: false, reason: `${label} is not a plugin registry object` };
  }

  const plugins = new Map<string, JsonObject[]>();
  const seen = new Set<string>();
  for (const [pluginId, records] of Object.entries(input.plugins)) {
    if (!Array.isArray(records) || !records.every(isObject)) {
      return { ok: false, reason: `${label} entry ${pluginId} is not a list of records` };
    }
    for (const record of records) {
      const key = recordKey(pluginId, record);
      if (seen.has(key)) {
        return {
          ok: false,
          reason: `${label} holds two records for ${describeKey(pluginId, record)}`,
        };
      }
      seen.add(key);
    }
    plugins.set(pluginId, records);
  }
  return { ok: true, parsed: { registry: input, plugins } };
}

function indexByKey(parsed: ParsedRegistry): Map<string, JsonObject> {
  const index = new Map<string, JsonObject>();
  for (const [pluginId, records] of parsed.plugins) {
    for (const record of records) index.set(recordKey(pluginId, record), record);
  }
  return index;
}

function parseBase(base: unknown, canonicalVersion: unknown): Map<string, JsonObject> | null {
  if (base === null || base === undefined) return null;
  const outcome = parseRegistry(base, 'base snapshot');
  if (!outcome.ok || outcome.parsed.registry.version !== canonicalVersion) return null;
  return indexByKey(outcome.parsed);
}

function copyWins(canonical: JsonObject, copy: JsonObject): boolean {
  if (typeof canonical.lastUpdated !== 'string' || typeof copy.lastUpdated !== 'string') {
    return false;
  }
  const canonicalTime = Date.parse(canonical.lastUpdated);
  const copyTime = Date.parse(copy.lastUpdated);
  if (Number.isNaN(canonicalTime) || Number.isNaN(copyTime)) return false;
  return copyTime > canonicalTime;
}

/**
 * Merge a home's copy of installed_plugins.json into the canonical registry,
 * one record at a time, 3-way against the home's base snapshot.
 */
export function mergePluginRegistries(
  base: unknown,
  canonical: unknown,
  copy: unknown
): PluginRegistryMergeResult {
  const canonicalOutcome = parseRegistry(canonical, 'canonical registry');
  if (!canonicalOutcome.ok) return canonicalOutcome;
  const copyOutcome = parseRegistry(copy, 'copy registry');
  if (!copyOutcome.ok) return copyOutcome;

  const canonicalParsed = canonicalOutcome.parsed;
  const copyParsed = copyOutcome.parsed;
  if (copyParsed.registry.version !== canonicalParsed.registry.version) {
    return {
      ok: false,
      reason: `copy registry version ${JSON.stringify(copyParsed.registry.version)} differs from canonical version ${JSON.stringify(canonicalParsed.registry.version)}`,
    };
  }

  const baseIndex = parseBase(base, canonicalParsed.registry.version);
  const copyIndex = indexByKey(copyParsed);
  const canonicalIndex = indexByKey(canonicalParsed);

  const updated: PluginRecordRef[] = [];
  const added: PluginRecordRef[] = [];
  const dropped: PluginRecordRef[] = [];
  const mergedPlugins = new Map<string, JsonObject[]>();

  for (const [pluginId, records] of canonicalParsed.plugins) {
    const result: JsonObject[] = [];
    for (const record of records) {
      const key = recordKey(pluginId, record);
      const copyRecord = copyIndex.get(key);
      if (copyRecord) {
        if (copyWins(record, copyRecord)) {
          result.push(copyRecord);
          if (!sameRecord(record, copyRecord)) updated.push(refOf(pluginId, record));
        } else {
          result.push(record);
        }
        continue;
      }
      const baseRecord = baseIndex?.get(key);
      if (baseRecord && sameRecord(baseRecord, record)) {
        dropped.push(refOf(pluginId, record));
      } else {
        result.push(record);
      }
    }
    mergedPlugins.set(pluginId, result);
  }

  for (const [pluginId, records] of copyParsed.plugins) {
    for (const record of records) {
      const key = recordKey(pluginId, record);
      if (canonicalIndex.has(key)) continue;
      const baseRecord = baseIndex?.get(key);
      if (baseRecord && sameRecord(baseRecord, record)) continue;
      const existing = mergedPlugins.get(pluginId);
      if (existing) existing.push(record);
      else mergedPlugins.set(pluginId, [record]);
      added.push(refOf(pluginId, record));
    }
  }

  const plugins: JsonObject = {};
  for (const [pluginId, records] of mergedPlugins) {
    const hadRecords = (canonicalParsed.plugins.get(pluginId)?.length ?? 0) > 0;
    if (records.length > 0 || !hadRecords) plugins[pluginId] = records;
  }

  return {
    ok: true,
    registry: { ...canonicalParsed.registry, plugins },
    updated,
    added,
    dropped,
  };
}
