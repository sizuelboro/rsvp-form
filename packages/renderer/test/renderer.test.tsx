import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getTemplate, TEMPLATES, type FormSchema } from '@rsvp/core';
import { FormRenderer, Markdown, SubmitError } from '../src/index';

afterEach(cleanup);
const tpl = (id: string) => structuredClone(getTemplate(id)!.schema) as FormSchema;
const ok = { submissionId: 's1', confirmation: { title: 'Thanks!', message: 'Recorded' } };

describe('FormRenderer', () => {
  it('renders every template in every layout without crashing', () => {
    for (const t of TEMPLATES) {
      for (const layout of ['standard', 'multistep', 'conversational'] as const) {
        const s = structuredClone(t.schema);
        s.settings.layout = layout;
        const { unmount } = render(<FormRenderer schema={s} mode="preview" />);
        unmount();
      }
    }
  });

  it('shows accept-only fields after choosing accept (shared logic engine)', () => {
    render(<FormRenderer schema={tpl('wedding-classic')} mode="preview" />);
    expect(screen.queryByText('How many guests in your party?')).toBeNull();
    fireEvent.click(screen.getByLabelText('Joyfully accept'));
    expect(screen.getByText('How many guests in your party?')).toBeTruthy();
    expect(screen.queryByText('Leave a note for the couple')).toBeNull();
    fireEvent.click(screen.getByLabelText('Regretfully decline'));
    expect(screen.queryByText('How many guests in your party?')).toBeNull();
    expect(screen.getByText('Leave a note for the couple')).toBeTruthy();
  });

  it('validates required fields before calling onSubmit, then submits answers', async () => {
    const onSubmit = vi.fn().mockResolvedValue(ok);
    render(<FormRenderer schema={tpl('contact-us')} onSubmit={onSubmit} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })); });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText(/^Email address/), { target: { value: 'ann@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: 'Hello there, this is long enough.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })); });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ full_name: 'Ann', email: 'ann@example.com' });
    expect(screen.getByText('Thanks!')).toBeTruthy();
  });

  it('maps server-side field errors back onto fields', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new SubmitError('Please fix the highlighted fields', { email: 'Already registered' }));
    render(<FormRenderer schema={tpl('webinar-registration')} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText(/^Email address/), { target: { value: 'ann@example.com' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save my seat' })); });
    expect(screen.getByText('Already registered')).toBeTruthy();
  });

  it('navigates multi-step forms with per-step validation and goto logic', async () => {
    render(<FormRenderer schema={tpl('wedding-multi-event')} mode="preview" />);
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Next/ })); });
    expect(screen.getByText('Step 1 of 4')).toBeTruthy(); // blocked by validation
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText(/^Email address/), { target: { value: 'ann@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Phone number/), { target: { value: '+91 98765 43210' } });
    fireEvent.click(screen.getByLabelText('Sorry, I can’t make it'));
    expect(screen.getByText('Step 1 of 2')).toBeTruthy(); // path recomputed: decline skips to the note
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Next/ })); });
    expect(screen.getByText('A note for the couple', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm RSVP' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Back/ })); });
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });

  it('runs conversational forms one question at a time with keyboard support', async () => {
    vi.useFakeTimers();
    render(<FormRenderer schema={tpl('customer-feedback')} mode="preview" />);
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    expect(screen.getByText('How would you rate your experience?')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '2 of 5' }));
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.getByText('Sorry to hear that. What went wrong?')).toBeTruthy();
    vi.useRealTimers();
  });

  it('shows the confirmation with an entry QR code in preview', async () => {
    const s = tpl('wedding-classic');
    render(<FormRenderer schema={s} mode="preview" checkinUrl={(t) => `https://x/c/${t}`} />);
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText(/^Email address/), { target: { value: 'g@example.com' } });
    fireEvent.click(screen.getByLabelText('Joyfully accept'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send RSVP' })); });
    expect(screen.getByText('Thank you, Grace!')).toBeTruthy();
    expect(screen.getByAltText('Check-in QR code')).toBeTruthy();
  });
});

describe('Markdown', () => {
  it('renders a safe subset and never executes markup or javascript: links', () => {
    const { container } = render(<Markdown source={'**bold** _it_ [ok](https://a.com) [bad](javascript:alert(1)) <img src=x onerror=alert(1)>\n\n- one\n- two'} />);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });
});
