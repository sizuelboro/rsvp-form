import { useEffect, useMemo, useState } from 'react';
import { GitBranch, Plus, Trash2, X } from 'lucide-react';
import {
  ACTION_TYPES, allElements, checkIntegrity, FIELD_DEFINITIONS, OPERATORS, type Condition, type FormElement, type LogicAction, type LogicRule, type Operator,
} from '@rsvp/core';
import { Badge, Button, Dialog, EmptyState, Input, Select, Segmented } from '../../components/ui';
import { useEditor } from './store';
import { useSession } from '../../stores/session';

const OP_LABEL: Record<Operator, string> = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain', greater_than: 'is greater than',
  less_than: 'is less than', is_empty: 'is empty', is_not_empty: 'is not empty',
};
const ACTION_LABEL: Record<LogicAction['type'], string> = {
  show: 'Show field', hide: 'Hide field', require: 'Make required', unrequire: 'Make optional', goto_page: 'Go to page', skip_page: 'Skip page', show_message: 'Show message',
};

function valueChoices(el: FormElement | undefined): { id: string; label: string }[] | null {
  if (!el) return null;
  if (el.type === 'attendance') return [{ id: 'accept', label: el.config.acceptLabel || 'Accept' }, { id: 'decline', label: el.config.declineLabel || 'Decline' }, ...(el.config.allowMaybe ? [{ id: 'maybe', label: el.config.maybeLabel || 'Maybe' }] : [])];
  if (el.type === 'yes_no' || el.type === 'plus_one') return [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];
  if (el.type === 'country') return null;
  if (el.config.options?.length) return el.config.options.map((o) => ({ id: o.id, label: o.label }));
  return null;
}

let ruleSeq = 0;
const newRuleId = (rules: LogicRule[]): string => { let id: string; do { id = `rule_${Date.now().toString(36)}${ruleSeq++}`; } while (rules.some((r) => r.id === id)); return id; };

function ConditionRow({ c, inputs, onChange, onRemove, canRemove }: { c: Condition; inputs: FormElement[]; onChange: (c: Condition) => void; onRemove: () => void; canRemove: boolean }) {
  const el = inputs.find((e) => e.id === c.fieldId);
  const ops = (el ? FIELD_DEFINITIONS[el.type].logicOperators ?? OPERATORS : OPERATORS) as readonly Operator[];
  const base = valueChoices(el);
  const choices = base && c.value !== undefined && c.value !== '' && !base.some((o) => o.id === String(c.value)) ? [...base, { id: String(c.value), label: `${c.value} (not currently offered)` }] : base;
  const needsValue = c.operator !== 'is_empty' && c.operator !== 'is_not_empty';
  const numeric = el && ['number', 'rating', 'guest_count'].includes(el.type);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="w-[200px] flex-1 min-w-[160px]" value={c.fieldId} onChange={(e) => {
        const next = inputs.find((x) => x.id === e.target.value);
        const nextOps = (next ? FIELD_DEFINITIONS[next.type].logicOperators ?? OPERATORS : OPERATORS) as readonly Operator[];
        onChange({ fieldId: e.target.value, operator: nextOps.includes(c.operator) ? c.operator : nextOps[0]!, value: undefined });
      }} aria-label="Field">
        {inputs.map((i) => <option key={i.id} value={i.id}>{i.label || i.id}</option>)}
      </Select>
      <Select className="w-[160px]" value={c.operator} onChange={(e) => onChange({ ...c, operator: e.target.value as Operator })} aria-label="Operator">
        {ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
      </Select>
      {needsValue && (choices ? (
        <Select className="w-[180px]" value={String(c.value ?? '')} onChange={(e) => onChange({ ...c, value: e.target.value })} aria-label="Value">
          <option value="">Choose…</option>{choices.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
      ) : (
        <Input className="w-[160px]" type={numeric ? 'number' : 'text'} value={c.value === undefined ? '' : String(c.value)} placeholder="Value" aria-label="Value"
          onChange={(e) => onChange({ ...c, value: numeric ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value })} />
      ))}
      {canRemove && <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove condition"><X className="size-3.5" /></Button>}
    </div>
  );
}

function ActionRow({ a, all, pages, onChange, onRemove, canRemove }: { a: LogicAction; all: FormElement[]; pages: { id: string; label: string }[]; onChange: (a: LogicAction) => void; onRemove: () => void; canRemove: boolean }) {
  const isPage = a.type === 'goto_page' || a.type === 'skip_page';
  const isField = !isPage && a.type !== 'show_message';
  const targets = a.type === 'require' || a.type === 'unrequire' ? all.filter((e) => FIELD_DEFINITIONS[e.type].isInput) : all;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="w-[160px]" value={a.type} onChange={(e) => onChange({ type: e.target.value as LogicAction['type'] })} aria-label="Action">
        {ACTION_TYPES.map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}
      </Select>
      {isField && <Select className="flex-1 min-w-[180px]" value={a.target ?? ''} onChange={(e) => onChange({ ...a, target: e.target.value })} aria-label="Target field"><option value="">Choose field…</option>{targets.map((e) => <option key={e.id} value={e.id}>{e.label || `${FIELD_DEFINITIONS[e.type].name} (${e.id})`}</option>)}</Select>}
      {isPage && <Select className="flex-1 min-w-[160px]" value={a.target ?? ''} onChange={(e) => onChange({ ...a, target: e.target.value })} aria-label="Target page"><option value="">Choose page…</option>{pages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>}
      {a.type === 'goto_page' && <Select className="w-[180px]" value={a.fromPage ?? ''} onChange={(e) => onChange({ ...a, fromPage: e.target.value || undefined })} aria-label="When leaving page"><option value="">when leaving the question’s page</option>{pages.map((p) => <option key={p.id} value={p.id}>when leaving {p.label}</option>)}</Select>}
      {a.type === 'show_message' && <Input className="flex-1 min-w-[200px]" value={a.message ?? ''} placeholder="Message to show" onChange={(e) => onChange({ ...a, message: e.target.value })} aria-label="Message" />}
      {canRemove && <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove action"><X className="size-3.5" /></Button>}
    </div>
  );
}

export function LogicBuilder({ open, onOpenChange, seedFieldId }: { open: boolean; onOpenChange: (v: boolean) => void; seedFieldId?: string }) {
  const schema = useEditor((s) => s.schema)!;
  const setLogic = useEditor((s) => s.setLogic);
  const entitled = useSession((s) => s.workspace?.entitlements.features.conditionalLogic);
  const [rules, setRules] = useState<LogicRule[]>(schema.logic);
  const all = useMemo(() => allElements(schema).filter((e) => e.type !== 'hidden' || true), [schema]);
  const inputs = useMemo(() => all.filter((e) => FIELD_DEFINITIONS[e.type].isInput && e.type !== 'payment'), [all]);
  const pages = schema.pages.map((p, i) => ({ id: p.id, label: p.title ? `${i + 1}. ${p.title}` : `Page ${i + 1}` }));

  const blankRule = (fieldId?: string): LogicRule => {
    const f = inputs.find((i) => i.id === fieldId) ?? inputs[0];
    const ops = (f ? FIELD_DEFINITIONS[f.type].logicOperators ?? OPERATORS : OPERATORS) as readonly Operator[];
    return { id: newRuleId(rules), name: '', combinator: 'and', conditions: [{ fieldId: f?.id ?? '', operator: ops[0]!, value: undefined }], actions: [{ type: 'show', target: '' }] };
  };

  useEffect(() => {
    if (!open) return;
    setRules(seedFieldId ? [...schema.logic, blankRule(seedFieldId)] : schema.logic);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const issues = useMemo(() => checkIntegrity({ ...schema, logic: rules }).filter((i) => i.path.startsWith('logic')), [schema, rules]);
  const incomplete = rules.some((r) => r.conditions.some((c) => !c.fieldId || (c.operator !== 'is_empty' && c.operator !== 'is_not_empty' && (c.value === undefined || c.value === ''))));
  const patchRule = (i: number, fn: (r: LogicRule) => LogicRule) => setRules((rs) => rs.map((r, j) => (j === i ? fn(r) : r)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl" title="Conditional logic" description="Rules run in the editor preview, on the public form and again on the server when responses are submitted."
      footer={<>
        {(issues.length > 0 || incomplete) && <span className="mr-auto text-[12.5px] text-danger self-center">{incomplete ? 'Fill in every condition value.' : issues[0]?.message}</span>}
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" disabled={issues.length > 0 || incomplete} onClick={() => { setLogic(rules); onOpenChange(false); }}>Save rules</Button>
      </>}>
      {!entitled && <div className="mb-4 rounded-lg border border-warning/30 bg-warning-50 px-3.5 py-2.5 text-[12.5px] text-warning">Conditional logic is included in Pro and above. You can build rules now — publishing will require an upgrade.</div>}
      {rules.length === 0 ? (
        <EmptyState compact icon={<GitBranch />} title="No rules yet" description="Example: if “Will you attend?” is Accept, show guest count and meal choice." action={<Button variant="primary" icon={<Plus className="size-4" />} disabled={!inputs.length} onClick={() => setRules([blankRule()])}>Add rule</Button>} />
      ) : (
        <div className="space-y-3">
          {rules.map((r, i) => (
            <div key={r.id} className="rounded-xl border border-line bg-canvas/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Badge tone="brand">Rule {i + 1}</Badge>
                <input value={r.name ?? ''} placeholder="Name this rule (optional)" onChange={(e) => patchRule(i, (x) => ({ ...x, name: e.target.value }))} className="flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-faint" aria-label="Rule name" />
                <Button variant="ghost" size="icon-sm" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} aria-label="Delete rule"><Trash2 className="size-3.5" /></Button>
              </div>
              <div className="grid grid-cols-[56px_1fr] gap-x-3 gap-y-2 items-start">
                <span className="text-[12px] font-semibold text-muted pt-2">IF</span>
                <div className="space-y-2">
                  {r.conditions.map((c, ci) => (
                    <div key={ci}>
                      {ci > 0 && <div className="mb-2"><Segmented size="sm" value={r.combinator} onChange={(v) => patchRule(i, (x) => ({ ...x, combinator: v }))} items={[{ value: 'and', label: 'AND' }, { value: 'or', label: 'OR' }]} /></div>}
                      <ConditionRow c={c} inputs={inputs} canRemove={r.conditions.length > 1}
                        onChange={(nc) => patchRule(i, (x) => ({ ...x, conditions: x.conditions.map((y, k) => (k === ci ? nc : y)) }))}
                        onRemove={() => patchRule(i, (x) => ({ ...x, conditions: x.conditions.filter((_, k) => k !== ci) }))} />
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => patchRule(i, (x) => ({ ...x, conditions: [...x.conditions, { fieldId: inputs[0]?.id ?? '', operator: 'equals', value: undefined }] }))}>Add condition</Button>
                </div>
                <span className="text-[12px] font-semibold text-muted pt-2">THEN</span>
                <div className="space-y-2">
                  {r.actions.map((a, ai) => (
                    <ActionRow key={ai} a={a} all={all} pages={pages} canRemove={r.actions.length > 1}
                      onChange={(na) => patchRule(i, (x) => ({ ...x, actions: x.actions.map((y, k) => (k === ai ? na : y)) }))}
                      onRemove={() => patchRule(i, (x) => ({ ...x, actions: x.actions.filter((_, k) => k !== ai) }))} />
                  ))}
                  <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => patchRule(i, (x) => ({ ...x, actions: [...x.actions, { type: 'show', target: '' }] }))}>Add action</Button>
                </div>
              </div>
            </div>
          ))}
          <Button icon={<Plus className="size-4" />} onClick={() => setRules((rs) => [...rs, blankRule()])}>Add rule</Button>
          <p className="hint">Fields targeted by a “Show field” action stay hidden until one of their rules matches.</p>
        </div>
      )}
    </Dialog>
  );
}
