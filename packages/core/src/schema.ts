import { z } from 'zod';

/**
 * Versioned JSON form schema.
 *
 * The same schema is consumed by the visual editor, the public renderer and the
 * API Worker (server-side validation). Bump CURRENT_SCHEMA_VERSION and add a
 * migration in migrate.ts whenever the persisted shape changes.
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

export const FIELD_TYPES = [
  // basic
  'short_text', 'long_text', 'email', 'phone', 'number', 'website', 'date', 'time',
  // choice
  'single_choice', 'multiple_choice', 'dropdown', 'yes_no', 'rating', 'image_choice',
  // rsvp
  'attendance', 'guest_count', 'guest_names', 'plus_one', 'meal_preference', 'dietary',
  'accommodation', 'transportation', 'event_selection', 'rsvp_deadline_info',
  // advanced
  'file_upload', 'signature', 'address', 'country', 'payment', 'hidden',
  // content
  'heading', 'paragraph', 'image', 'video', 'divider', 'spacer', 'section', 'rich_text',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Stable identifiers: lowercase, digits, underscore. Never derived from labels after creation. */
export const idSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, digits and underscores');

export const optionSchema = z.object({
  id: idSchema,
  label: z.string().max(200),
  imageUrl: z.string().url().max(2048).optional(),
});
export type ChoiceOption = z.infer<typeof optionSchema>;

/** Per-element appearance overrides. These survive global theme changes. */
export const elementStyleSchema = z.object({
  align: z.enum(['left', 'center', 'right']).optional(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  fontSize: z.number().min(10).max(72).optional(),
  fontWeight: z.number().min(100).max(900).optional(),
  background: z.string().max(64).optional(),
  borderColor: z.string().max(64).optional(),
  radius: z.number().min(0).max(48).optional(),
  paddingY: z.number().min(0).max(96).optional(),
  width: z.enum(['full', 'half']).optional(),
}).strict();
export type ElementStyle = z.infer<typeof elementStyleSchema>;

export const elementConfigSchema = z.object({
  // choices
  options: z.array(optionSchema).max(200).optional(),
  allowOther: z.boolean().optional(),
  multiple: z.boolean().optional(),
  minSelections: z.number().int().min(0).optional(),
  maxSelections: z.number().int().min(1).optional(),
  randomize: z.boolean().optional(),
  // text / number validation
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).max(10000).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  pattern: z.enum(['none', 'letters', 'alphanumeric', 'digits']).optional(),
  rows: z.number().int().min(2).max(20).optional(),
  // rating
  scale: z.number().int().min(3).max(10).optional(),
  ratingIcon: z.enum(['star', 'heart', 'number']).optional(),
  // RSVP
  allowMaybe: z.boolean().optional(),
  acceptLabel: z.string().max(80).optional(),
  declineLabel: z.string().max(80).optional(),
  maybeLabel: z.string().max(80).optional(),
  splitAdultsChildren: z.boolean().optional(),
  maxGuests: z.number().int().min(1).max(100).optional(),
  minGuests: z.number().int().min(0).max(100).optional(),
  collectContact: z.boolean().optional(),
  sessionIds: z.array(z.string().max(64)).max(50).optional(),
  // uploads
  accept: z.array(z.string().max(64)).max(20).optional(),
  maxFileSizeMb: z.number().min(0.1).max(25).optional(),
  maxFiles: z.number().int().min(1).max(10).optional(),
  // payment
  amount: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  // content
  content: z.string().max(20000).optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  url: z.string().max(2048).optional(),
  alt: z.string().max(300).optional(),
  height: z.number().int().min(4).max(400).optional(),
  collapsed: z.boolean().optional(),
  // hidden
  source: z.enum(['static', 'query']).optional(),
  queryParam: z.string().max(64).optional(),
}).strict();
export type ElementConfig = z.infer<typeof elementConfigSchema>;

export const elementSchema = z.object({
  id: idSchema,
  type: z.enum(FIELD_TYPES),
  label: z.string().max(500).default(''),
  description: z.string().max(2000).optional(),
  placeholder: z.string().max(300).optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  config: elementConfigSchema.default({}),
  style: elementStyleSchema.optional(),
});
export type FormElement = z.infer<typeof elementSchema>;

export const pageSchema = z.object({
  id: idSchema,
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  elements: z.array(elementSchema).max(300),
});
export type FormPage = z.infer<typeof pageSchema>;

export const OPERATORS = [
  'equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty',
] as const;
export type Operator = (typeof OPERATORS)[number];

export const conditionSchema = z.object({
  fieldId: idSchema,
  operator: z.enum(OPERATORS),
  value: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const ACTION_TYPES = ['show', 'hide', 'require', 'unrequire', 'goto_page', 'skip_page', 'show_message'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const actionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  /** element id for show/hide/require, page id for goto/skip */
  target: z.string().max(64).optional(),
  /** goto_page only: rule applies when leaving this page */
  fromPage: z.string().max(64).optional(),
  message: z.string().max(1000).optional(),
});
export type LogicAction = z.infer<typeof actionSchema>;

export const ruleSchema = z.object({
  id: idSchema,
  name: z.string().max(120).optional(),
  combinator: z.enum(['and', 'or']).default('and'),
  conditions: z.array(conditionSchema).min(1).max(20),
  actions: z.array(actionSchema).min(1).max(20),
});
export type LogicRule = z.infer<typeof ruleSchema>;

export const FONT_KEYS = [
  'inter', 'dm_sans', 'manrope', 'space_grotesk', 'poppins', 'nunito',
  'playfair', 'cormorant', 'fraunces', 'lora', 'libre_baskerville', 'system',
] as const;
export type FontKey = (typeof FONT_KEYS)[number];

const color = z.string().max(64);

export const themeTokensSchema = z.object({
  typography: z.object({
    headingFont: z.enum(FONT_KEYS),
    bodyFont: z.enum(FONT_KEYS),
    baseSize: z.number().min(12).max(22),
    headingWeight: z.number().min(300).max(900),
    bodyWeight: z.number().min(300).max(700),
    lineHeight: z.number().min(1).max(2.2),
    letterSpacing: z.number().min(-0.05).max(0.2),
    headingScale: z.number().min(1.1).max(2),
  }),
  colors: z.object({
    primary: color,
    secondary: color,
    background: color,
    surface: color,
    text: color,
    muted: color,
    border: color,
    inputBackground: color,
    buttonBackground: color,
    buttonText: color,
  }),
  layout: z.object({
    formWidth: z.number().min(360).max(1200),
    alignment: z.enum(['left', 'center']),
    sectionSpacing: z.number().min(8).max(96),
    fieldSpacing: z.number().min(4).max(64),
    containerPadding: z.number().min(0).max(96),
  }),
  appearance: z.object({
    radius: z.number().min(0).max(32),
    shadow: z.enum(['none', 'sm', 'md', 'lg']),
    borderWidth: z.number().min(0).max(4),
    inputStyle: z.enum(['outline', 'filled', 'underline']),
    buttonStyle: z.enum(['solid', 'outline', 'pill']),
    surfaceStyle: z.enum(['card', 'flat']),
    backgroundImage: z.string().max(2048).optional(),
    backgroundPattern: z.enum(['none', 'dots', 'grid', 'lines', 'confetti']),
  }),
});
export type ThemeTokens = z.infer<typeof themeTokensSchema>;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const themeOverridesSchema = z.object({
  typography: themeTokensSchema.shape.typography.partial().optional(),
  colors: themeTokensSchema.shape.colors.partial().optional(),
  layout: themeTokensSchema.shape.layout.partial().optional(),
  appearance: themeTokensSchema.shape.appearance.partial().optional(),
});
export type ThemeOverrides = z.infer<typeof themeOverridesSchema>;

export const formThemeSchema = z.object({
  presetId: z.string().max(64).default('minimal'),
  overrides: themeOverridesSchema.default({}),
});
export type FormTheme = z.infer<typeof formThemeSchema>;

export const settingsSchema = z.object({
  layout: z.enum(['standard', 'conversational', 'multistep']).default('standard'),
  submitLabel: z.string().max(80).default('Submit'),
  allowMultipleSubmissions: z.boolean().default(false),
  showProgress: z.boolean().default(true),
  coverImage: z.string().max(2048).optional(),
  logoUrl: z.string().max(2048).optional(),
  hideBranding: z.boolean().optional(),
  confirmation: z.object({
    title: z.string().max(200).default('Thank you!'),
    message: z.string().max(2000).default('Your response has been recorded.'),
    /** Optional message shown when attendance is declined */
    declineMessage: z.string().max(2000).optional(),
    showEventDetails: z.boolean().default(true),
    showQrCode: z.boolean().default(true),
    redirectUrl: z.string().url().max(2048).optional(),
  }).default({}),
});
export type FormSettings = z.infer<typeof settingsSchema>;

export const formSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  form: z.object({
    title: z.string().max(200),
    description: z.string().max(5000).optional(),
  }),
  settings: settingsSchema.default({}),
  theme: formThemeSchema.default({}),
  pages: z.array(pageSchema).min(1).max(50),
  logic: z.array(ruleSchema).max(200).default([]),
});
export type FormSchema = z.infer<typeof formSchemaV1>;
/** Input type (defaults optional) */
export type FormSchemaInput = z.input<typeof formSchemaV1>;

export type IntegrityIssue = { path: string; message: string };

/**
 * Structural checks beyond shape validation: unique IDs, logic references, option IDs.
 */
export function checkIntegrity(schema: FormSchema): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const pageIds = new Set<string>();
  const elementIds = new Set<string>();
  schema.pages.forEach((page, pi) => {
    if (pageIds.has(page.id)) issues.push({ path: `pages.${pi}.id`, message: `Duplicate page id "${page.id}"` });
    pageIds.add(page.id);
    page.elements.forEach((el, ei) => {
      if (elementIds.has(el.id)) issues.push({ path: `pages.${pi}.elements.${ei}.id`, message: `Duplicate element id "${el.id}"` });
      elementIds.add(el.id);
      const opts = el.config.options;
      if (opts) {
        const seen = new Set<string>();
        opts.forEach((o, oi) => {
          if (seen.has(o.id)) issues.push({ path: `pages.${pi}.elements.${ei}.config.options.${oi}`, message: `Duplicate option id "${o.id}"` });
          seen.add(o.id);
        });
      }
      if (el.config.min !== undefined && el.config.max !== undefined && el.config.min > el.config.max) {
        issues.push({ path: `pages.${pi}.elements.${ei}.config`, message: 'Minimum is greater than maximum' });
      }
    });
  });
  schema.logic.forEach((rule, ri) => {
    rule.conditions.forEach((c, ci) => {
      if (!elementIds.has(c.fieldId)) issues.push({ path: `logic.${ri}.conditions.${ci}`, message: `Unknown field "${c.fieldId}"` });
    });
    rule.actions.forEach((a, ai) => {
      const needsElement = a.type === 'show' || a.type === 'hide' || a.type === 'require' || a.type === 'unrequire';
      const needsPage = a.type === 'goto_page' || a.type === 'skip_page';
      if (needsElement && (!a.target || !elementIds.has(a.target))) issues.push({ path: `logic.${ri}.actions.${ai}`, message: 'Action targets an unknown field' });
      if (needsPage && (!a.target || !pageIds.has(a.target))) issues.push({ path: `logic.${ri}.actions.${ai}`, message: 'Action targets an unknown page' });
      if (a.type === 'goto_page' && a.fromPage && !pageIds.has(a.fromPage)) issues.push({ path: `logic.${ri}.actions.${ai}`, message: 'Unknown source page' });
      if (a.type === 'show_message' && !a.message) issues.push({ path: `logic.${ri}.actions.${ai}`, message: 'Message is empty' });
    });
  });
  return issues;
}

export type ParseResult = { ok: true; schema: FormSchema } | { ok: false; issues: IntegrityIssue[] };

export function parseFormSchema(input: unknown): ParseResult {
  const result = formSchemaV1.safeParse(input);
  if (!result.success) {
    return { ok: false, issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  const issues = checkIntegrity(result.data);
  if (issues.length) return { ok: false, issues };
  return { ok: true, schema: result.data };
}

export function allElements(schema: Pick<FormSchema, 'pages'>): FormElement[] {
  return schema.pages.flatMap((p) => p.elements);
}

export function findElement(schema: Pick<FormSchema, 'pages'>, id: string): FormElement | undefined {
  for (const p of schema.pages) for (const e of p.elements) if (e.id === id) return e;
  return undefined;
}
