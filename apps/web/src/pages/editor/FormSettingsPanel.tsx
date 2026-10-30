import { Field, Input, Row, Segmented, Switch, Textarea, UrlInput } from './_ui';
import { useEditor } from './store';
import { Section } from './Inspector';
import { useSession } from '../../stores/session';

/** Form-level settings stored in the schema (rendering, submit, confirmation). Access & deadline live in the Publish settings. */
export function FormSettingsPanel() {
  const settings = useEditor((s) => s.schema!.settings);
  const update = useEditor((s) => s.update);
  const canBrand = useSession((s) => s.workspace?.entitlements.features.customBranding);
  const set = (fn: (st: typeof settings) => void, key: string) => update((s) => fn(s.settings), key);
  return (
    <div>
      <Section title="Experience">
        <Field label="Layout">
          <Segmented value={settings.layout} onChange={(v) => set((st) => { st.layout = v; }, 'layout')} items={[{ value: 'standard', label: 'Standard' }, { value: 'multistep', label: 'Multi-step' }, { value: 'conversational', label: 'One at a time' }]} />
        </Field>
        <p className="hint">{settings.layout === 'standard' ? 'All questions on one page.' : settings.layout === 'multistep' ? 'One page per step with a progress bar and per-step validation.' : 'Conversational: one question at a time with keyboard shortcuts.'}</p>
        {settings.layout !== 'standard' && <Row label="Show progress"><Switch checked={settings.showProgress} onChange={(v) => set((st) => { st.showProgress = v; }, 'progress')} /></Row>}
        <Field label="Submit button"><Input value={settings.submitLabel} onChange={(e) => set((st) => { st.submitLabel = e.target.value || 'Submit'; }, 'submitLabel')} /></Field>
        <Row label="Allow multiple submissions per person"><Switch checked={settings.allowMultipleSubmissions} onChange={(v) => set((st) => { st.allowMultipleSubmissions = v; }, 'multi')} /></Row>
        <p className="hint">When off, repeat submissions with the same email are flagged as duplicates; invitees update their existing RSVP.</p>
      </Section>
      <Section title="Branding">
        <Field label="Cover image" hint="Shown above the form (https:// URL)"><UrlInput value={settings.coverImage} onCommit={(v) => set((st) => { st.coverImage = v; }, 'cover')} /></Field>
        <Field label="Logo" hint="https:// URL"><UrlInput value={settings.logoUrl} onCommit={(v) => set((st) => { st.logoUrl = v; }, 'logo')} /></Field>
        <Row label="Hide “Made with Invitely”"><Switch disabled={!canBrand} checked={Boolean(settings.hideBranding)} onChange={(v) => set((st) => { st.hideBranding = v || undefined; }, 'brand')} /></Row>
        {!canBrand && <p className="hint">Custom branding is available on Pro and above.</p>}
      </Section>
      <Section title="Confirmation screen">
        <Field label="Title" hint="Use {{field_id}} to insert answers, e.g. {{full_name}}"><Input value={settings.confirmation.title} onChange={(e) => set((st) => { st.confirmation.title = e.target.value; }, 'ctitle')} /></Field>
        <Field label="Message"><Textarea rows={3} value={settings.confirmation.message} onChange={(e) => set((st) => { st.confirmation.message = e.target.value; }, 'cmsg')} /></Field>
        <Field label="Message when declining" hint="Shown instead when attendance is declined"><Textarea rows={2} value={settings.confirmation.declineMessage ?? ''} onChange={(e) => set((st) => { st.confirmation.declineMessage = e.target.value || undefined; }, 'cdecl')} /></Field>
        <Row label="Show event details"><Switch checked={settings.confirmation.showEventDetails} onChange={(v) => set((st) => { st.confirmation.showEventDetails = v; }, 'cev')} /></Row>
        <Row label="Show entry QR code"><Switch checked={settings.confirmation.showQrCode} onChange={(v) => set((st) => { st.confirmation.showQrCode = v; }, 'cqr')} /></Row>
        <Field label="Redirect after submit (optional)"><UrlInput allowHttp value={settings.confirmation.redirectUrl} onCommit={(v) => set((st) => { st.confirmation.redirectUrl = v; }, 'credir')} /></Field>
      </Section>
    </div>
  );
}
