import { isDeepStrictEqual } from 'util';

/**
 * Default keys of settings.json: the top-level `model` and `effortLevel`, and
 * the `effortLevel` of each `modelSettings.<model id>` entry. At copy-back the
 * tracked file wins for these, so a switch made inside a session never becomes
 * the default of a later one.
 */
const DEFAULT_TOP_LEVEL_KEYS: readonly string[] = ['model', 'effortLevel'];
const MODEL_SETTINGS_KEY = 'modelSettings';
const ENTRY_DEFAULT_KEY = 'effortLevel';

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKey(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function mergeModelEntry(canonical: JsonRecord, saved: JsonRecord | undefined): JsonRecord {
  const merged: JsonRecord = {};
  for (const key of Object.keys(canonical)) {
    if (key === ENTRY_DEFAULT_KEY) {
      merged[key] = canonical[key];
    } else if (saved && hasKey(saved, key)) {
      merged[key] = saved[key];
    }
  }
  if (saved) {
    for (const key of Object.keys(saved)) {
      if (key !== ENTRY_DEFAULT_KEY && !hasKey(canonical, key)) merged[key] = saved[key];
    }
  }
  return merged;
}

function mergeModelSettingsMap(canonical: JsonRecord, saved: JsonRecord | undefined): JsonRecord {
  const merged: JsonRecord = {};
  for (const modelId of Object.keys(canonical)) {
    const canonicalEntry = canonical[modelId];
    const savedEntry = saved && hasKey(saved, modelId) ? saved[modelId] : undefined;
    if (isJsonRecord(canonicalEntry) && (savedEntry === undefined || isJsonRecord(savedEntry))) {
      merged[modelId] = mergeModelEntry(canonicalEntry, savedEntry);
    } else if (savedEntry !== undefined) {
      merged[modelId] = savedEntry;
    }
  }
  if (saved) {
    for (const modelId of Object.keys(saved)) {
      if (hasKey(canonical, modelId)) continue;
      const savedEntry = saved[modelId];
      if (!isJsonRecord(savedEntry)) {
        merged[modelId] = savedEntry;
        continue;
      }
      // An entry the saved file added that holds nothing but an effort level is not created.
      const kept = mergeModelEntry({}, savedEntry);
      if (Object.keys(kept).length > 0) merged[modelId] = kept;
    }
  }
  return merged;
}

function resolveModelSettings(
  canonicalValue: unknown,
  savedValue: unknown
): { value: unknown } | undefined {
  if (savedValue !== undefined && !isJsonRecord(savedValue)) return { value: savedValue };
  const canonicalMap = isJsonRecord(canonicalValue) ? canonicalValue : undefined;
  const savedMap = isJsonRecord(savedValue) ? savedValue : undefined;
  const merged = mergeModelSettingsMap(canonicalMap ?? {}, savedMap);
  if (Object.keys(merged).length > 0 || (canonicalMap && savedMap)) return { value: merged };
  return undefined;
}

function mergeSettings(canonical: JsonRecord, saved: JsonRecord): JsonRecord {
  const modelSettings = resolveModelSettings(
    canonical[MODEL_SETTINGS_KEY],
    saved[MODEL_SETTINGS_KEY]
  );
  const merged: JsonRecord = {};
  for (const key of Object.keys(canonical)) {
    if (DEFAULT_TOP_LEVEL_KEYS.includes(key)) {
      merged[key] = canonical[key];
    } else if (key === MODEL_SETTINGS_KEY) {
      if (modelSettings) merged[key] = modelSettings.value;
    } else if (hasKey(saved, key)) {
      merged[key] = saved[key];
    }
  }
  for (const key of Object.keys(saved)) {
    if (hasKey(canonical, key) || DEFAULT_TOP_LEVEL_KEYS.includes(key)) continue;
    if (key === MODEL_SETTINGS_KEY) {
      if (modelSettings) merged[key] = modelSettings.value;
    } else {
      merged[key] = saved[key];
    }
  }
  return merged;
}

export interface KeptDefaults {
  /** The saved file's content with every default key held at the canonical file's state. */
  content: Buffer;
  /** True when nothing but default keys differs, so the saved file is dropped whole. */
  identical: boolean;
}

export function keepTrackedDefaults(
  canonicalContent: Buffer,
  savedContent: Buffer
): KeptDefaults | null {
  let canonical: unknown;
  let saved: unknown;
  try {
    canonical = JSON.parse(canonicalContent.toString('utf8'));
    saved = JSON.parse(savedContent.toString('utf8'));
  } catch {
    return null;
  }
  if (!isJsonRecord(canonical) || !isJsonRecord(saved)) return null;

  const merged = mergeSettings(canonical, saved);
  return {
    content: Buffer.from(`${JSON.stringify(merged, null, 2)}\n`, 'utf8'),
    identical: isDeepStrictEqual(merged, canonical),
  };
}
