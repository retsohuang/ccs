import { describe, expect, it } from 'bun:test';

import {
  mergePluginRegistries,
  type PluginRegistryMergeResult,
} from '../../../src/management/shared-manager/plugin-registry-merge';

type Rec = Record<string, unknown>;

function rec(
  scope: string,
  projectPath: string | undefined,
  version: string,
  lastUpdated: string | undefined,
  extra: Rec = {}
): Rec {
  const record: Rec = { scope };
  if (projectPath !== undefined) record.projectPath = projectPath;
  record.installPath = `/cache/${version}`;
  record.version = version;
  if (lastUpdated !== undefined) record.lastUpdated = lastUpdated;
  return { ...record, ...extra };
}

function registry(plugins: Record<string, Rec[]>, extra: Rec = {}): Rec {
  return { version: 2, plugins, ...extra };
}

function merged(result: PluginRegistryMergeResult) {
  if (!result.ok) throw new Error(`expected a merge, got refusal: ${result.reason}`);
  return result;
}

function refusal(result: PluginRegistryMergeResult): string {
  if (result.ok) throw new Error('expected a refusal, got a merge');
  return result.reason;
}

const OLD = '2026-11-01T00:00:00.000Z';
const NEW = '2026-11-02T00:00:00.000Z';
const P = '/work/app';

describe('mergePluginRegistries record winner', () => {
  it('takes the copy record when its lastUpdated is newer', () => {
    const canonical = registry({ 'a@m': [rec('project', P, 'canon', OLD)] });
    const copy = registry({ 'a@m': [rec('project', P, 'copy', NEW)] });

    const result = merged(mergePluginRegistries(null, canonical, copy));

    expect((result.registry.plugins as Record<string, Rec[]>)['a@m']).toEqual([
      rec('project', P, 'copy', NEW),
    ]);
    expect(result.updated).toEqual([{ pluginId: 'a@m', scope: 'project', projectPath: P }]);
  });

  it('keeps the canonical record when its lastUpdated is newer', () => {
    const canonical = registry({ 'a@m': [rec('project', P, 'canon', NEW)] });
    const copy = registry({ 'a@m': [rec('project', P, 'copy', OLD)] });

    const result = merged(mergePluginRegistries(null, canonical, copy));

    expect(result.registry).toEqual(canonical);
    expect(result.updated).toEqual([]);
  });

  it('keeps the canonical record when lastUpdated is equal', () => {
    const canonical = registry({ 'a@m': [rec('project', P, 'canon', NEW)] });
    const copy = registry({ 'a@m': [rec('project', P, 'copy', NEW)] });

    expect(merged(mergePluginRegistries(null, canonical, copy)).registry).toEqual(canonical);
  });

  it('keeps the canonical record when either lastUpdated is missing', () => {
    const withDate = rec('project', P, 'dated', NEW);
    const withoutDate = rec('project', P, 'undated', undefined);

    const copyUndated = merged(
      mergePluginRegistries(
        null,
        registry({ 'a@m': [withDate] }),
        registry({ 'a@m': [withoutDate] })
      )
    );
    const canonicalUndated = merged(
      mergePluginRegistries(
        null,
        registry({ 'a@m': [withoutDate] }),
        registry({ 'a@m': [withDate] })
      )
    );

    expect(copyUndated.registry).toEqual(registry({ 'a@m': [withDate] }));
    expect(canonicalUndated.registry).toEqual(registry({ 'a@m': [withoutDate] }));
  });

  it('keeps the canonical record when either lastUpdated cannot be parsed', () => {
    const canonical = registry({ 'a@m': [rec('project', P, 'canon', 'not-a-date')] });
    const copy = registry({ 'a@m': [rec('project', P, 'copy', NEW)] });
    const garbageCopy = registry({ 'a@m': [rec('project', P, 'copy', 'garbage')] });
    const datedCanonical = registry({ 'a@m': [rec('project', P, 'canon', OLD)] });

    expect(merged(mergePluginRegistries(null, canonical, copy)).registry).toEqual(canonical);
    expect(merged(mergePluginRegistries(null, datedCanonical, garbageCopy)).registry).toEqual(
      datedCanonical
    );
  });

  it('replaces the whole record without mixing fields from the other side', () => {
    const canonical = registry({
      'a@m': [rec('project', P, 'canon', OLD, { gitCommitSha: 'canon-sha', canonOnly: true })],
    });
    const copy = registry({
      'a@m': [rec('project', P, 'copy', NEW, { gitCommitSha: 'copy-sha', copyOnly: true })],
    });

    const record = (
      merged(mergePluginRegistries(null, canonical, copy)).registry.plugins as Record<string, Rec[]>
    )['a@m'][0];

    expect(record).toEqual(
      rec('project', P, 'copy', NEW, { gitCommitSha: 'copy-sha', copyOnly: true })
    );
    expect(record).not.toHaveProperty('canonOnly');
  });

  it('does not list a copy win that leaves the record unchanged as updated', () => {
    const record = rec('project', P, 'same', NEW);
    const result = merged(
      mergePluginRegistries(
        null,
        registry({ 'a@m': [{ ...record }] }),
        registry({ 'a@m': [{ ...record }] })
      )
    );

    expect(result.updated).toEqual([]);
  });
});

describe('mergePluginRegistries ordering and top-level keys', () => {
  it('keeps canonical order, appends new records to their id list and new ids to plugins', () => {
    const canonical = registry({
      'a@m': [rec('project', '/p1', 'a1', OLD), rec('project', '/p2', 'a2', OLD)],
      'b@m': [rec('user', undefined, 'b1', OLD)],
    });
    const copy = registry({
      'c@m': [rec('user', undefined, 'c1', OLD)],
      'b@m': [rec('user', undefined, 'b1', OLD), rec('project', '/p3', 'b3', OLD)],
      'a@m': [rec('project', '/p2', 'a2', OLD), rec('project', '/p4', 'a4', OLD)],
    });

    const result = merged(mergePluginRegistries(null, canonical, copy));
    const plugins = result.registry.plugins as Record<string, Rec[]>;

    expect(Object.keys(plugins)).toEqual(['a@m', 'b@m', 'c@m']);
    expect(plugins['a@m'].map((r) => r.projectPath)).toEqual(['/p1', '/p2', '/p4']);
    expect(plugins['b@m'].map((r) => r.projectPath)).toEqual([undefined, '/p3']);
    expect(result.added).toEqual([
      { pluginId: 'c@m', scope: 'user', projectPath: undefined },
      { pluginId: 'b@m', scope: 'project', projectPath: '/p3' },
      { pluginId: 'a@m', scope: 'project', projectPath: '/p4' },
    ]);
  });

  it('keeps the canonical values for top-level keys other than plugins', () => {
    const canonical = registry({}, { generation: 7, note: 'canonical' });
    const copy = registry({}, { generation: 9, extra: 'copy-only' });

    const result = merged(mergePluginRegistries(null, canonical, copy));

    expect(result.registry).toEqual(canonical);
  });
});

describe('mergePluginRegistries one-sided records', () => {
  const kept = rec('project', P, 'kept', OLD);
  const other = rec('project', '/other', 'other', OLD);

  it('keeps a copy-only record that is not in the base', () => {
    const base = registry({ 'b@m': [other] });
    const canonical = registry({ 'b@m': [other] });
    const copy = registry({ 'b@m': [other], 'a@m': [kept] });

    const result = merged(mergePluginRegistries(base, canonical, copy));

    expect((result.registry.plugins as Record<string, Rec[]>)['a@m']).toEqual([kept]);
    expect(result.added).toEqual([{ pluginId: 'a@m', scope: 'project', projectPath: P }]);
  });

  it('keeps a canonical-only record that is not in the base', () => {
    const base = registry({ 'b@m': [other] });
    const canonical = registry({ 'b@m': [other], 'a@m': [kept] });
    const copy = registry({ 'b@m': [other] });

    const result = merged(mergePluginRegistries(base, canonical, copy));

    expect(result.registry).toEqual(canonical);
    expect(result.dropped).toEqual([]);
  });

  it('drops a canonical-only record that is in the base unchanged', () => {
    const base = registry({ 'a@m': [kept], 'b@m': [other] });
    const canonical = registry({ 'a@m': [{ ...kept }], 'b@m': [other] });
    const copy = registry({ 'b@m': [other] });

    const result = merged(mergePluginRegistries(base, canonical, copy));

    expect(result.registry).toEqual(registry({ 'b@m': [other] }));
    expect(result.dropped).toEqual([{ pluginId: 'a@m', scope: 'project', projectPath: P }]);
  });

  it('drops a copy-only record that is in the base unchanged', () => {
    const base = registry({ 'a@m': [kept], 'b@m': [other] });
    const canonical = registry({ 'b@m': [other] });
    const copy = registry({ 'a@m': [{ ...kept }], 'b@m': [other] });

    const result = merged(mergePluginRegistries(base, canonical, copy));

    expect(result.registry).toEqual(canonical);
    expect(result.added).toEqual([]);
  });

  it('keeps a canonical-only record that changed since the base over the copy delete', () => {
    const base = registry({ 'a@m': [kept] });
    const changed = rec('project', P, 'changed', NEW);
    const canonical = registry({ 'a@m': [changed] });
    const copy = registry({});

    const result = merged(mergePluginRegistries(base, canonical, copy));

    expect(result.registry).toEqual(canonical);
    expect(result.dropped).toEqual([]);
  });

  it('keeps a copy-only record that changed since the base over the canonical delete', () => {
    const base = registry({ 'a@m': [kept] });
    const changed = rec('project', P, 'changed', NEW);
    const canonical = registry({});
    const copy = registry({ 'a@m': [changed] });

    const result = merged(mergePluginRegistries(base, canonical, copy));

    expect((result.registry.plugins as Record<string, Rec[]>)['a@m']).toEqual([changed]);
    expect(result.added).toEqual([{ pluginId: 'a@m', scope: 'project', projectPath: P }]);
  });

  it('keeps every one-sided record when there is no base', () => {
    const canonical = registry({ 'a@m': [kept] });
    const copy = registry({ 'b@m': [other] });

    const result = merged(mergePluginRegistries(null, canonical, copy));

    expect(Object.keys(result.registry.plugins as object)).toEqual(['a@m', 'b@m']);
    expect(result.dropped).toEqual([]);
  });

  it('removes a plugin id whose records were all dropped', () => {
    const base = registry({ 'a@m': [kept] });
    const canonical = registry({ 'a@m': [kept] });

    const result = merged(mergePluginRegistries(base, canonical, registry({})));

    expect(result.registry.plugins).toEqual({});
  });
});

describe('mergePluginRegistries record key', () => {
  it('keys a user-scope record apart from a project-scope record of the same id', () => {
    const user = rec('user', undefined, 'user', OLD);
    const project = rec('project', P, 'project', OLD);

    const result = merged(
      mergePluginRegistries(null, registry({ 'a@m': [user] }), registry({ 'a@m': [project] }))
    );

    expect((result.registry.plugins as Record<string, Rec[]>)['a@m']).toEqual([user, project]);
  });

  it('keys the same plugin and project apart by scope', () => {
    const local = rec('local', P, 'local', OLD);
    const project = rec('project', P, 'project', OLD);

    const result = merged(
      mergePluginRegistries(null, registry({ 'a@m': [local] }), registry({ 'a@m': [project] }))
    );

    expect((result.registry.plugins as Record<string, Rec[]>)['a@m']).toEqual([local, project]);
  });
});

describe('mergePluginRegistries shape guard', () => {
  const ok = registry({ 'a@m': [rec('user', undefined, 'v', OLD)] });

  it('refuses when the copy version differs from the canonical version', () => {
    const reason = refusal(mergePluginRegistries(null, ok, { ...ok, version: 3 }));

    expect(reason).toContain('version');
  });

  it('refuses when a plugins entry is not a list of records', () => {
    const notList = { version: 2, plugins: { 'a@m': { scope: 'user' } } };
    const notRecords = { version: 2, plugins: { 'a@m': ['x'] } };

    expect(refusal(mergePluginRegistries(null, ok, notList))).toContain('a@m');
    expect(refusal(mergePluginRegistries(null, notList, ok))).toContain('a@m');
    expect(refusal(mergePluginRegistries(null, ok, notRecords))).toContain('a@m');
  });

  it('refuses when one file holds two records with the same key', () => {
    const duplicated = registry({
      'a@m': [rec('project', P, 'one', OLD), rec('project', P, 'two', NEW)],
    });

    expect(refusal(mergePluginRegistries(null, ok, duplicated))).toContain('a@m');
    expect(refusal(mergePluginRegistries(null, duplicated, ok))).toContain('a@m');
  });

  it('refuses a file that is not an object with a plugins object', () => {
    expect(refusal(mergePluginRegistries(null, ok, [] as unknown))).toContain('copy registry');
    expect(refusal(mergePluginRegistries(null, ok, { version: 2, plugins: [] }))).toContain(
      'copy registry'
    );
    expect(refusal(mergePluginRegistries(null, null as unknown, ok))).toContain(
      'canonical registry'
    );
  });

  it('treats a base with a different version as absent', () => {
    const record = rec('project', P, 'kept', OLD);
    const staleBase = { version: 1, plugins: { 'a@m': [record] } };
    const canonical = registry({ 'a@m': [record] });

    const result = merged(mergePluginRegistries(staleBase, canonical, registry({})));

    expect(result.registry).toEqual(canonical);
    expect(result.dropped).toEqual([]);
  });

  it('treats a base that fails the shape checks as absent', () => {
    const record = rec('project', P, 'kept', OLD);
    const canonical = registry({ 'a@m': [record] });
    const badBases: unknown[] = [
      'text',
      { version: 2, plugins: { 'a@m': 'nope' } },
      { version: 2, plugins: { 'a@m': [record, { ...record }] } },
    ];

    for (const base of badBases) {
      const result = merged(mergePluginRegistries(base, canonical, registry({})));
      expect(result.registry).toEqual(canonical);
    }
  });
});
