import type { FormSchema } from '../schema';
import { buildSchema, el, opts, rsvpLogic } from './builder';

export const TEMPLATE_CATEGORIES = [
  { id: 'wedding', name: 'Wedding RSVP' },
  { id: 'birthday', name: 'Birthday RSVP' },
  { id: 'engagement', name: 'Engagement RSVP' },
  { id: 'anniversary', name: 'Anniversary RSVP' },
  { id: 'baby_shower', name: 'Baby Shower RSVP' },
  { id: 'graduation', name: 'Graduation RSVP' },
  { id: 'corporate', name: 'Corporate Registration' },
  { id: 'conference', name: 'Conference Registration' },
  { id: 'workshop', name: 'Workshop Registration' },
  { id: 'webinar', name: 'Webinar Registration' },
  { id: 'party', name: 'Party Invitation' },
  { id: 'dinner', name: 'Dinner Reservation' },
  { id: 'community', name: 'Community Event' },
  { id: 'feedback', name: 'Feedback Form' },
  { id: 'contact', name: 'Contact Form' },
  { id: 'survey', name: 'Survey' },
  { id: 'application', name: 'Application Form' },
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]['id'];

export interface TemplateDefinition {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  /** whether the template is designed around an event (enables RSVP wiring) */
  isRsvp: boolean;
  featured?: boolean;
  popularity: number;
  addedAt: string;
  schema: FormSchema;
}

const t = (d: TemplateDefinition) => d;

const contactBlock = (nameLabel = 'Full name') => [
  el('short_text', 'full_name', { label: nameLabel, required: true, placeholder: 'Your full name' }),
  el('email', 'email', { required: true }),
];

export const TEMPLATES: TemplateDefinition[] = [
  t({
    id: 'wedding-classic', name: 'Classic Wedding RSVP', category: 'wedding', isRsvp: true, featured: true, popularity: 98, addedAt: '2026-01-10',
    description: 'Attendance, party size, meals and dietary needs with accept/decline branching.',
    schema: buildSchema({
      title: 'Sarah & John', description: 'We would love to celebrate our wedding with you. Kindly respond by the date below.',
      theme: { presetId: 'romantic' },
      settings: { submitLabel: 'Send RSVP', confirmation: { title: 'Thank you, {{full_name}}!', message: 'We can’t wait to celebrate with you.', declineMessage: 'We’ll miss you — thank you for letting us know.' } },
      pages: [{ id: 'page_1', elements: [
        el('rsvp_deadline_info', 'deadline_note', { label: 'Kindly respond by 15 November' }),
        ...contactBlock(),
        el('attendance', 'attendance'),
        el('guest_count', 'guest_count', { config: { minGuests: 1, maxGuests: 4, splitAdultsChildren: true } }),
        el('guest_names', 'guest_names', { label: 'Names of guests in your party', config: { maxGuests: 4 } }),
        el('meal_preference', 'meal'),
        el('dietary', 'dietary'),
        el('long_text', 'decline_message', { label: 'Leave a note for the couple', placeholder: 'Optional message', required: false }),
        el('long_text', 'song_request', { label: 'Any song that will get you on the dance floor?', required: false, config: { rows: 2 } }),
      ] }],
      logic: rsvpLogic('attendance', ['guest_count', 'guest_names', 'meal', 'dietary', 'song_request'], ['decline_message']),
    }),
  }),
  t({
    id: 'wedding-multi-event', name: 'Multi-Event Wedding', category: 'wedding', isRsvp: true, featured: true, popularity: 95, addedAt: '2026-03-02',
    description: 'Mehendi, ceremony, reception and after party with stay and travel details across steps.',
    schema: buildSchema({
      title: 'Aisha & Rohan — Wedding Celebrations', description: 'Three days of celebrations in Udaipur. Let us know which events you’ll join.',
      theme: { presetId: 'elegant' },
      settings: { layout: 'multistep', submitLabel: 'Confirm RSVP', confirmation: { title: 'See you in Udaipur!', message: 'Your RSVP is confirmed. Your entry pass is below.' } },
      pages: [
        { id: 'page_guest', title: 'Your details', elements: [...contactBlock(), el('phone', 'phone', { required: true }), el('attendance', 'attendance', { config: { allowMaybe: true, acceptLabel: 'Yes, I’ll be there', declineLabel: 'Sorry, I can’t make it', maybeLabel: 'Not sure yet' } })] },
        { id: 'page_events', title: 'Celebrations', elements: [
          el('event_selection', 'events', { required: true, config: { options: opts('Mehendi', 'Wedding Ceremony', 'Reception', 'After Party') } }),
          el('guest_count', 'guest_count', { config: { minGuests: 1, maxGuests: 6, splitAdultsChildren: true } }),
          el('guest_names', 'guest_names', { config: { maxGuests: 6 } }),
          el('meal_preference', 'meal', { config: { options: opts('Vegetarian', 'Jain', 'Non-vegetarian', 'Vegan') } }),
          el('dietary', 'dietary'),
        ] },
        { id: 'page_travel', title: 'Stay & travel', elements: [
          el('accommodation', 'accommodation'),
          el('transportation', 'transportation'),
          el('date', 'arrival_date', { label: 'Arrival date' }),
        ] },
        { id: 'page_decline', title: 'A note for the couple', elements: [el('long_text', 'note', { label: 'Send your wishes', required: false })] },
      ],
      logic: [
        { id: 'decline_jump', name: 'Declining guests skip to the note', combinator: 'and', conditions: [{ fieldId: 'attendance', operator: 'equals', value: 'decline' }], actions: [{ type: 'goto_page', target: 'page_decline', fromPage: 'page_guest' }] },
        { id: 'stay_needed', name: 'Ask arrival date when a room is needed', combinator: 'and', conditions: [{ fieldId: 'accommodation', operator: 'not_equals', value: 'not_needed' }, { fieldId: 'accommodation', operator: 'is_not_empty' }], actions: [{ type: 'show', target: 'arrival_date' }, { type: 'require', target: 'arrival_date' }] },
      ],
    }),
  }),
  t({
    id: 'birthday-party', name: 'Birthday Party RSVP', category: 'birthday', isRsvp: true, popularity: 90, addedAt: '2026-01-14',
    description: 'A cheerful RSVP with headcount for adults and kids.',
    schema: buildSchema({
      title: 'Maya turns 30! 🎉', description: 'Join us for an evening of food, music and questionable dance moves.',
      theme: { presetId: 'playful' }, settings: { submitLabel: 'Count me in', confirmation: { title: 'Yay, see you there!', message: 'We’ve saved you a slice of cake.' } },
      pages: [{ id: 'page_1', elements: [
        el('short_text', 'full_name', { label: 'Your name', required: true }),
        el('attendance', 'attendance', { config: { allowMaybe: true, acceptLabel: 'I’ll be there', declineLabel: 'Can’t make it' } }),
        el('guest_count', 'guest_count', { label: 'How many are coming?', config: { minGuests: 1, maxGuests: 5, splitAdultsChildren: true } }),
        el('dietary', 'dietary', { label: 'Anything we should know food-wise?' }),
        el('long_text', 'wishes', { label: 'Birthday wishes', required: false, config: { rows: 3 } }),
      ] }],
      logic: rsvpLogic('attendance', ['guest_count', 'dietary'], []),
    }),
  }),
  t({
    id: 'engagement-celebration', name: 'Engagement Celebration', category: 'engagement', isRsvp: true, popularity: 82, addedAt: '2026-02-01',
    description: 'An elegant RSVP with a plus-one option.',
    schema: buildSchema({
      title: 'Priya & Arjun are engaged', description: 'Please join us for an intimate celebration.',
      theme: { presetId: 'elegant' }, settings: { submitLabel: 'Reply' },
      pages: [{ id: 'page_1', elements: [
        ...contactBlock(), el('attendance', 'attendance'), el('plus_one', 'plus_one'), el('meal_preference', 'meal'),
        el('long_text', 'message', { label: 'A message for the couple', required: false }),
      ] }],
      logic: rsvpLogic('attendance', ['plus_one', 'meal'], []),
    }),
  }),
  t({
    id: 'anniversary-dinner', name: 'Anniversary Dinner', category: 'anniversary', isRsvp: true, popularity: 70, addedAt: '2026-02-12',
    description: 'A classic anniversary RSVP with meal selection.',
    schema: buildSchema({
      title: '25 Years of Meera & Raj', description: 'Celebrate a silver anniversary with family and friends.',
      theme: { presetId: 'classic' },
      pages: [{ id: 'page_1', elements: [
        ...contactBlock(), el('attendance', 'attendance'),
        el('guest_count', 'guest_count', { config: { minGuests: 1, maxGuests: 3 } }),
        el('meal_preference', 'meal', { config: { options: opts('Vegetarian thali', 'Grilled fish', 'Vegan platter') } }),
        el('long_text', 'memory', { label: 'Share a favourite memory', required: false }),
      ] }],
      logic: rsvpLogic('attendance', ['guest_count', 'meal'], []),
    }),
  }),
  t({
    id: 'baby-shower', name: 'Baby Shower', category: 'baby_shower', isRsvp: true, popularity: 76, addedAt: '2026-02-20',
    description: 'RSVP with a fun guess-the-date game.',
    schema: buildSchema({
      title: 'Baby Shower for Ananya', description: 'Oh baby! Join us to shower the mama-to-be with love.',
      theme: { presetId: 'playful', overrides: { colors: { primary: '#6FA8A0', buttonBackground: '#6FA8A0', background: '#F3FAF8', secondary: '#DDF0EC', border: '#D2E8E3' } } },
      pages: [{ id: 'page_1', elements: [
        ...contactBlock(), el('attendance', 'attendance'),
        el('guest_count', 'guest_count', { config: { minGuests: 1, maxGuests: 3 } }),
        el('date', 'guess_date', { label: 'Guess the arrival date!' }),
        el('single_choice', 'guess', { label: 'Boy, girl, or surprise?', config: { options: opts('Boy', 'Girl', 'It’s a surprise') } }),
      ] }],
      logic: rsvpLogic('attendance', ['guest_count'], []),
    }),
  }),
  t({
    id: 'graduation-party', name: 'Graduation Party', category: 'graduation', isRsvp: true, popularity: 64, addedAt: '2026-03-10',
    description: 'Celebrate the graduate with a colourful RSVP.',
    schema: buildSchema({
      title: 'Class of 2026: Kabir graduates!', description: 'Come celebrate a big milestone.',
      theme: { presetId: 'colorful' },
      pages: [{ id: 'page_1', elements: [
        el('short_text', 'full_name', { label: 'Your name', required: true }), el('attendance', 'attendance', { config: { allowMaybe: true } }),
        el('guest_count', 'guest_count', { config: { minGuests: 1, maxGuests: 4 } }),
        el('long_text', 'advice', { label: 'Advice for the graduate', required: false }),
      ] }],
      logic: rsvpLogic('attendance', ['guest_count'], []),
    }),
  }),
  t({
    id: 'corporate-offsite', name: 'Corporate Offsite Registration', category: 'corporate', isRsvp: true, featured: true, popularity: 86, addedAt: '2026-01-20',
    description: 'Team, travel, room sharing and T-shirt sizes for company offsites.',
    schema: buildSchema({
      title: 'Annual Offsite 2026', description: 'Register for our company offsite in Goa.',
      theme: { presetId: 'corporate' }, settings: { submitLabel: 'Register' },
      pages: [{ id: 'page_1', elements: [
        el('short_text', 'full_name', { label: 'Full name', required: true }), el('email', 'email', { label: 'Work email', required: true }),
        el('dropdown', 'team', { label: 'Team', required: true, config: { options: opts('Engineering', 'Design', 'Product', 'Sales', 'Operations') } }),
        el('attendance', 'attendance', { config: { acceptLabel: 'I’m attending', declineLabel: 'I can’t attend' } }),
        el('transportation', 'transportation', { config: { options: opts('Company flight', 'I’ll travel on my own') } }),
        el('single_choice', 'tshirt', { label: 'T-shirt size', config: { options: opts('S', 'M', 'L', 'XL', 'XXL') } }),
        el('meal_preference', 'meal'),
      ] }],
      logic: rsvpLogic('attendance', ['transportation', 'tshirt', 'meal'], []),
    }),
  }),
  t({
    id: 'conference-registration', name: 'Conference Registration', category: 'conference', isRsvp: true, featured: true, popularity: 92, addedAt: '2026-01-05',
    description: 'Multi-step registration with ticket types, tracks and accommodation.',
    schema: buildSchema({
      title: 'BuildConf 2026', description: 'Two days of talks on product, design and engineering.',
      theme: { presetId: 'modern' }, settings: { layout: 'multistep', submitLabel: 'Complete registration', confirmation: { title: 'You’re registered!', message: 'Your ticket QR code is below. Show it at the entrance.' } },
      pages: [
        { id: 'page_attendee', title: 'Attendee', elements: [...contactBlock(), el('short_text', 'company', { label: 'Company' }), el('short_text', 'job_title', { label: 'Job title' })] },
        { id: 'page_ticket', title: 'Ticket', elements: [
          el('single_choice', 'ticket', { label: 'Ticket type', required: true, config: { options: opts('Standard', 'Student', 'VIP') } }),
          el('file_upload', 'student_id', { label: 'Upload your student ID', config: { accept: ['image/*', 'application/pdf'], maxFileSizeMb: 5, maxFiles: 1 } }),
          el('event_selection', 'tracks', { label: 'Which tracks interest you?', config: { options: opts('Product', 'Design', 'Engineering', 'AI') } }),
        ] },
        { id: 'page_stay', title: 'Stay', elements: [el('accommodation', 'accommodation'), el('dietary', 'dietary')] },
      ],
      logic: [{ id: 'student', name: 'Students upload ID', combinator: 'and', conditions: [{ fieldId: 'ticket', operator: 'equals', value: 'student' }], actions: [{ type: 'show', target: 'student_id' }, { type: 'require', target: 'student_id' }] }],
    }),
  }),
  t({
    id: 'workshop-registration', name: 'Workshop Registration', category: 'workshop', isRsvp: true, popularity: 74, addedAt: '2026-02-05',
    description: 'Collect experience level and goals for hands-on sessions.',
    schema: buildSchema({
      title: 'Hands-on Pottery Workshop', description: 'Limited seats. Materials provided.', theme: { presetId: 'minimal', overrides: { colors: { primary: '#B4643C', buttonBackground: '#B4643C' } } },
      pages: [{ id: 'page_1', elements: [
        ...contactBlock(), el('phone', 'phone'),
        el('single_choice', 'level', { label: 'Experience level', required: true, config: { options: opts('Beginner', 'Intermediate', 'Advanced') } }),
        el('long_text', 'goals', { label: 'What do you hope to learn?' }),
      ] }],
    }),
  }),
  t({
    id: 'webinar-registration', name: 'Webinar Registration', category: 'webinar', isRsvp: true, popularity: 80, addedAt: '2026-02-08',
    description: 'A fast, single-step sign-up for online events.',
    schema: buildSchema({
      title: 'Webinar: Designing for Trust', description: 'Live online · 45 minutes · Q&A included.', theme: { presetId: 'minimal' }, settings: { submitLabel: 'Save my seat' },
      pages: [{ id: 'page_1', elements: [...contactBlock(), el('short_text', 'company', { label: 'Company' }), el('long_text', 'question', { label: 'A question for the speaker', config: { rows: 2 } })] }],
    }),
  }),
  t({
    id: 'party-invitation', name: 'Party Invitation', category: 'party', isRsvp: true, popularity: 85, addedAt: '2026-03-15',
    description: 'A conversational, one-question-at-a-time party RSVP.',
    schema: buildSchema({
      title: 'Rooftop Summer Party', description: 'Drinks, DJ and sunset views.', theme: { presetId: 'colorful' }, settings: { layout: 'conversational', submitLabel: 'Send' },
      pages: [{ id: 'page_1', elements: [
        el('short_text', 'full_name', { label: 'First things first — what’s your name?', required: true }),
        el('attendance', 'attendance', { label: 'Are you coming?', config: { allowMaybe: true, acceptLabel: 'Wouldn’t miss it', declineLabel: 'Next time' } }),
        el('plus_one', 'plus_one'),
        el('multiple_choice', 'drinks', { label: 'What are you drinking?', config: { options: opts('Mocktails', 'Beer', 'Wine', 'Something stronger') } }),
      ] }],
      logic: rsvpLogic('attendance', ['plus_one', 'drinks'], []),
    }),
  }),
  t({
    id: 'dinner-reservation', name: 'Dinner Reservation', category: 'dinner', isRsvp: true, popularity: 68, addedAt: '2026-03-20',
    description: 'Reserve a table with date, time, party size and occasion.',
    schema: buildSchema({
      title: 'Reserve a table', description: 'Chef’s tasting menu · Thursday to Sunday.', theme: { presetId: 'luxury' }, settings: { submitLabel: 'Request reservation' },
      pages: [{ id: 'page_1', elements: [
        ...contactBlock('Name for the reservation'), el('phone', 'phone', { required: true }),
        el('date', 'date', { label: 'Date', required: true }), el('time', 'time', { label: 'Time', required: true }),
        el('guest_count', 'guest_count', { label: 'Party size', config: { minGuests: 1, maxGuests: 10 } }),
        el('dropdown', 'occasion', { label: 'Occasion', config: { options: opts('None', 'Birthday', 'Anniversary', 'Business') } }),
        el('dietary', 'dietary'),
      ] }],
    }),
  }),
  t({
    id: 'community-meetup', name: 'Community Meetup', category: 'community', isRsvp: true, popularity: 72, addedAt: '2026-04-01',
    description: 'Friendly sign-up for local meetups and volunteering.',
    schema: buildSchema({
      title: 'Neighbourhood Clean-up Drive', description: 'Bring gloves, we’ll bring snacks.', theme: { presetId: 'playful', overrides: { colors: { primary: '#3E8E5E', buttonBackground: '#3E8E5E', background: '#F3F8F2', border: '#D8E8D6', secondary: '#E0F0E2' } } },
      pages: [{ id: 'page_1', elements: [
        ...contactBlock(), el('attendance', 'attendance'),
        el('multiple_choice', 'help', { label: 'How would you like to help?', config: { options: opts('Collecting', 'Sorting recyclables', 'Refreshments', 'Photography') } }),
        el('yes_no', 'newsletter', { label: 'Join our community newsletter?' }),
      ] }],
      logic: rsvpLogic('attendance', ['help'], []),
    }),
  }),
  t({
    id: 'customer-feedback', name: 'Customer Feedback', category: 'feedback', isRsvp: false, featured: true, popularity: 88, addedAt: '2026-01-25',
    description: 'Conversational feedback with follow-ups for low ratings.',
    schema: buildSchema({
      title: 'How did we do?', description: 'Two minutes to help us improve.', theme: { presetId: 'minimal' }, settings: { layout: 'conversational', submitLabel: 'Send feedback', confirmation: { title: 'Thank you!', message: 'We read every response.', showQrCode: false, showEventDetails: false } },
      pages: [{ id: 'page_1', elements: [
        el('rating', 'rating', { label: 'How would you rate your experience?', required: true }),
        el('long_text', 'improve', { label: 'Sorry to hear that. What went wrong?', required: false }),
        el('long_text', 'liked', { label: 'What did you enjoy most?', required: false }),
        el('email', 'email', { label: 'Email (if you’d like a reply)' }),
      ] }],
      logic: [
        { id: 'low', name: 'Low rating follow-up', combinator: 'and', conditions: [{ fieldId: 'rating', operator: 'less_than', value: 3 }], actions: [{ type: 'show', target: 'improve' }, { type: 'require', target: 'improve' }] },
        { id: 'high', name: 'High rating follow-up', combinator: 'and', conditions: [{ fieldId: 'rating', operator: 'greater_than', value: 2 }], actions: [{ type: 'show', target: 'liked' }] },
      ],
    }),
  }),
  t({
    id: 'event-feedback', name: 'Post-Event Feedback', category: 'feedback', isRsvp: false, popularity: 66, addedAt: '2026-04-10',
    description: 'Gather ratings on venue, content and organisation.',
    schema: buildSchema({
      title: 'Thanks for attending!', description: 'Tell us how the event went.', theme: { presetId: 'modern' }, settings: { confirmation: { title: 'Thank you!', message: 'Your feedback helps us plan the next one.', showQrCode: false, showEventDetails: false } },
      pages: [{ id: 'page_1', elements: [
        el('rating', 'overall', { label: 'Overall experience', required: true }),
        el('rating', 'venue', { label: 'Venue', config: { scale: 5, ratingIcon: 'heart' } }),
        el('rating', 'nps', { label: 'How likely are you to recommend us? (1–10)', config: { scale: 10, ratingIcon: 'number' } }),
        el('long_text', 'comments', { label: 'Anything else?' }),
      ] }],
    }),
  }),
  t({
    id: 'contact-us', name: 'Contact Us', category: 'contact', isRsvp: false, popularity: 94, addedAt: '2026-01-02',
    description: 'A clean, simple contact form.',
    schema: buildSchema({
      title: 'Get in touch', description: 'We usually reply within one business day.', theme: { presetId: 'minimal' }, settings: { submitLabel: 'Send message', confirmation: { title: 'Message sent', message: 'Thanks for reaching out — we’ll be in touch soon.', showQrCode: false, showEventDetails: false } },
      pages: [{ id: 'page_1', elements: [
        el('short_text', 'full_name', { label: 'Name', required: true, style: { width: 'half' } }), el('email', 'email', { required: true, style: { width: 'half' } }),
        el('dropdown', 'topic', { label: 'Topic', config: { options: opts('General', 'Support', 'Partnerships', 'Press') } }),
        el('long_text', 'message', { label: 'Message', required: true, config: { minLength: 10, rows: 5 } }),
      ] }],
    }),
  }),
  t({
    id: 'lead-generation', name: 'Lead Capture', category: 'contact', isRsvp: false, popularity: 78, addedAt: '2026-04-15',
    description: 'Qualify leads with company size, budget and UTM tracking.',
    schema: buildSchema({
      title: 'Book a demo', description: 'See how teams use our platform.', theme: { presetId: 'corporate' }, settings: { submitLabel: 'Request demo', confirmation: { title: 'Request received', message: 'Our team will reach out to schedule your demo.', showQrCode: false, showEventDetails: false } },
      pages: [{ id: 'page_1', elements: [
        el('short_text', 'full_name', { label: 'Name', required: true }), el('email', 'email', { label: 'Work email', required: true }),
        el('short_text', 'company', { label: 'Company', required: true }), el('website', 'website', { label: 'Company website' }),
        el('dropdown', 'size', { label: 'Company size', config: { options: opts('1–10', '11–50', '51–200', '201–1000', '1000+') } }),
        el('country', 'country'),
        el('hidden', 'utm_source', { label: 'UTM source', config: { source: 'query', queryParam: 'utm_source' } }),
      ] }],
    }),
  }),
  t({
    id: 'customer-survey', name: 'Customer Survey', category: 'survey', isRsvp: false, popularity: 83, addedAt: '2026-02-25',
    description: 'A multi-step survey with satisfaction and product questions.',
    schema: buildSchema({
      title: 'Product Survey 2026', description: 'Help shape what we build next.', theme: { presetId: 'editorial' }, settings: { layout: 'multistep', submitLabel: 'Submit survey', confirmation: { title: 'Thank you!', message: 'Your answers have been recorded.', showQrCode: false, showEventDetails: false } },
      pages: [
        { id: 'page_about', title: 'About you', elements: [
          el('single_choice', 'role', { label: 'Which best describes your role?', required: true, config: { options: opts('Founder', 'Designer', 'Engineer', 'Marketer'), allowOther: true } }),
          el('dropdown', 'usage', { label: 'How often do you use the product?', required: true, config: { options: opts('Daily', 'Weekly', 'Monthly', 'Rarely') } }),
        ] },
        { id: 'page_product', title: 'The product', elements: [
          el('rating', 'satisfaction', { label: 'Overall satisfaction', required: true }),
          el('multiple_choice', 'features', { label: 'Which features do you use?', config: { options: opts('Forms', 'Events', 'Guest lists', 'Analytics', 'Check-in') } }),
          el('long_text', 'wish', { label: 'If you could add one feature, what would it be?' }),
        ] },
      ],
    }),
  }),
  t({
    id: 'job-application', name: 'Job Application', category: 'application', isRsvp: false, popularity: 79, addedAt: '2026-03-05',
    description: 'Collect resumes, portfolios and motivation in two steps.',
    schema: buildSchema({
      title: 'Apply: Senior Product Designer', description: 'Remote-friendly · Bengaluru', theme: { presetId: 'corporate' }, settings: { layout: 'multistep', submitLabel: 'Submit application', confirmation: { title: 'Application received', message: 'Thank you for applying. We’ll review your application and get back to you.', showQrCode: false, showEventDetails: false } },
      pages: [
        { id: 'page_details', title: 'Your details', elements: [...contactBlock(), el('phone', 'phone', { required: true }), el('website', 'portfolio', { label: 'Portfolio URL', required: true }), el('address', 'address')] },
        { id: 'page_experience', title: 'Experience', elements: [
          el('number', 'years', { label: 'Years of experience', required: true, config: { min: 0, max: 50 } }),
          el('file_upload', 'resume', { label: 'Resume (PDF)', required: true, config: { accept: ['application/pdf'], maxFileSizeMb: 10, maxFiles: 1 } }),
          el('long_text', 'motivation', { label: 'Why do you want to join us?', required: true, config: { minLength: 50 } }),
          el('signature', 'signature', { label: 'I confirm the information provided is accurate', required: true }),
        ] },
      ],
    }),
  }),
];

export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((tpl) => tpl.id === id);
}

export function blankSchema(title = 'Untitled form'): FormSchema {
  return buildSchema({ title, pages: [{ id: 'page_1', elements: [el('short_text', 'short_text_1', { label: 'What is your name?', required: true })] }] });
}

export function blankRsvpSchema(title = 'RSVP'): FormSchema {
  return buildSchema({
    title, description: 'Let us know if you can make it.', theme: { presetId: 'elegant' }, settings: { submitLabel: 'Send RSVP' },
    pages: [{ id: 'page_1', elements: [...contactBlock(), el('attendance', 'attendance'), el('guest_count', 'guest_count'), el('meal_preference', 'meal'), el('long_text', 'message', { label: 'Message', required: false })] }],
    logic: rsvpLogic('attendance', ['guest_count', 'meal'], []),
  });
}
