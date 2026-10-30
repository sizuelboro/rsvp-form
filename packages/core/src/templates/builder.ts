import { FIELD_DEFINITIONS } from '../fields';
import type { FieldType, FormElement, FormSchema, LogicRule, FormSettings, FormTheme, ChoiceOption } from '../schema';

type ElOverrides = Partial<Omit<FormElement, 'id' | 'type' | 'config'>> & { config?: FormElement['config'] };

/** Build an element from registry defaults. */
export function el(type: FieldType, id: string, o: ElOverrides = {}): FormElement {
  const d = FIELD_DEFINITIONS[type].defaults();
  return { id, type, ...d, ...o, config: { ...structuredClone(d.config), ...(o.config ?? {}) } };
}

export const opts = (...labels: string[]): ChoiceOption[] =>
  labels.map((label) => {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'option';
    return { id: /^[a-z]/.test(slug) ? slug : `o_${slug}`, label };
  });

export interface SchemaParts {
  title: string;
  description?: string;
  pages: { id: string; title?: string; description?: string; elements: FormElement[] }[];
  logic?: LogicRule[];
  settings?: Partial<Omit<FormSettings, 'confirmation'>> & { confirmation?: Partial<FormSettings['confirmation']> };
  theme?: Partial<FormTheme>;
}

export function buildSchema(p: SchemaParts): FormSchema {
  const settings: FormSettings = {
    layout: 'standard',
    submitLabel: 'Submit',
    allowMultipleSubmissions: false,
    showProgress: true,
    ...p.settings,
    confirmation: {
      title: 'Thank you!',
      message: 'Your response has been recorded.',
      showEventDetails: true,
      showQrCode: true,
      ...p.settings?.confirmation,
    },
  };
  return {
    schemaVersion: 1,
    form: { title: p.title, description: p.description },
    settings,
    theme: { presetId: p.theme?.presetId ?? 'minimal', overrides: p.theme?.overrides ?? {} },
    pages: p.pages,
    logic: p.logic ?? [],
  };
}

/** Standard RSVP attendance branching used by most event templates. */
export function rsvpLogic(attendanceId: string, acceptTargets: string[], declineTargets: string[]): LogicRule[] {
  const rules: LogicRule[] = [];
  if (acceptTargets.length) rules.push({ id: 'if_accepting', name: 'Show details for guests who accept', combinator: 'or', conditions: [{ fieldId: attendanceId, operator: 'equals', value: 'accept' }, { fieldId: attendanceId, operator: 'equals', value: 'maybe' }], actions: acceptTargets.map((t) => ({ type: 'show' as const, target: t })) });
  if (declineTargets.length) rules.push({ id: 'if_declining', name: 'Show message field for guests who decline', combinator: 'and', conditions: [{ fieldId: attendanceId, operator: 'equals', value: 'decline' }], actions: declineTargets.map((t) => ({ type: 'show' as const, target: t })) });
  return rules;
}
