import { CURRENT_SCHEMA_VERSION, parseFormSchema, type ParseResult } from './schema';

/**
 * Schema migrations. Each entry upgrades a document from version N to N+1.
 * Stored form_versions are never rewritten; migrations are applied on read so the
 * renderer always receives the current shape while history stays byte-for-byte intact.
 */
type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: legacy flat `fields` array (as in the original product brief) becomes a single page.
  0: (doc) => {
    const fields = Array.isArray(doc.fields) ? doc.fields : [];
    const { fields: _f, ...rest } = doc;
    return {
      ...rest,
      schemaVersion: 1,
      pages: [{
        id: 'page_1',
        elements: fields.map((f: Record<string, unknown>) => {
          const { id, type, label, required, description, placeholder, options, min, max, ...cfg } = f;
          return {
            id, type, label: label ?? '', required, description, placeholder,
            config: {
              ...(Array.isArray(options) ? { options: options.map((o: unknown) => (typeof o === 'string' ? { id: o.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: o } : o)) } : {}),
              ...(typeof min === 'number' ? { min } : {}),
              ...(typeof max === 'number' ? { max } : {}),
              ...(cfg.config as object | undefined),
            },
          };
        }),
      }],
    };
  },
};

export function migrateSchema(input: unknown): ParseResult {
  if (!input || typeof input !== 'object') return { ok: false, issues: [{ path: '', message: 'Schema must be an object' }] };
  let doc = input as Record<string, unknown>;
  let version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;
  if (version > CURRENT_SCHEMA_VERSION) {
    return { ok: false, issues: [{ path: 'schemaVersion', message: `Schema version ${version} is newer than this renderer supports (${CURRENT_SCHEMA_VERSION})` }] };
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) return { ok: false, issues: [{ path: 'schemaVersion', message: `No migration from version ${version}` }] };
    doc = m(doc);
    version++;
  }
  return parseFormSchema(doc);
}
