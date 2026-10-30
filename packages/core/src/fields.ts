import type { ElementConfig, FieldType, FormElement } from './schema';

export type FieldCategory = 'basic' | 'choice' | 'rsvp' | 'advanced' | 'content';

/** Inspector sections that are relevant for a field type. The editor never shows irrelevant settings. */
export type InspectorSection =
  | 'placeholder' | 'required' | 'default' | 'options' | 'allowOther' | 'multiple'
  | 'textLength' | 'numberRange' | 'rating' | 'attendance' | 'guestCount' | 'upload'
  | 'payment' | 'content' | 'heading' | 'media' | 'spacer' | 'hidden' | 'sessions' | 'selections';

export type ValueKind =
  | 'none' | 'string' | 'number' | 'string_list' | 'guest_count' | 'plus_one' | 'dietary' | 'address' | 'files' | 'payment';

export interface FieldDefinition {
  type: FieldType;
  category: FieldCategory;
  name: string;
  description: string;
  /** lucide-react icon name */
  icon: string;
  /** collects an answer */
  isInput: boolean;
  valueKind: ValueKind;
  sections: InspectorSection[];
  defaults: () => Omit<FormElement, 'id' | 'type'>;
  /** Operators that make sense in conditional logic for this field */
  logicOperators?: readonly string[];
}

const TEXT_OPS = ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty'] as const;
const NUM_OPS = ['equals', 'not_equals', 'greater_than', 'less_than', 'is_empty', 'is_not_empty'] as const;
const CHOICE_OPS = ['equals', 'not_equals', 'is_empty', 'is_not_empty'] as const;
const LIST_OPS = ['contains', 'not_contains', 'is_empty', 'is_not_empty'] as const;

const opt = (id: string, label: string) => ({ id, label });

function def(d: FieldDefinition): FieldDefinition {
  return d;
}

const base = (label: string, extra: Partial<Omit<FormElement, 'id' | 'type'>> = {}) => ({
  label,
  required: false,
  config: {} as ElementConfig,
  ...extra,
});

export const FIELD_DEFINITIONS: Record<FieldType, FieldDefinition> = {
  short_text: def({ type: 'short_text', category: 'basic', name: 'Short text', description: 'A single line answer such as a name.', icon: 'Type', isInput: true, valueKind: 'string', sections: ['placeholder', 'required', 'default', 'textLength'], logicOperators: TEXT_OPS, defaults: () => base('Your answer', { placeholder: 'Type your answer' }) }),
  long_text: def({ type: 'long_text', category: 'basic', name: 'Long text', description: 'A paragraph answer for messages or notes.', icon: 'AlignLeft', isInput: true, valueKind: 'string', sections: ['placeholder', 'required', 'default', 'textLength'], logicOperators: TEXT_OPS, defaults: () => base('Tell us more', { placeholder: 'Write a message', config: { rows: 4 } }) }),
  email: def({ type: 'email', category: 'basic', name: 'Email', description: 'Validated email address.', icon: 'Mail', isInput: true, valueKind: 'string', sections: ['placeholder', 'required', 'default'], logicOperators: TEXT_OPS, defaults: () => base('Email address', { placeholder: 'name@example.com' }) }),
  phone: def({ type: 'phone', category: 'basic', name: 'Phone number', description: 'Validated phone number with country code.', icon: 'Phone', isInput: true, valueKind: 'string', sections: ['placeholder', 'required', 'default'], logicOperators: TEXT_OPS, defaults: () => base('Phone number', { placeholder: '+91 98765 43210' }) }),
  number: def({ type: 'number', category: 'basic', name: 'Number', description: 'Numeric answer with optional range.', icon: 'Hash', isInput: true, valueKind: 'number', sections: ['placeholder', 'required', 'default', 'numberRange'], logicOperators: NUM_OPS, defaults: () => base('Number', { placeholder: '0' }) }),
  website: def({ type: 'website', category: 'basic', name: 'Website', description: 'A validated URL.', icon: 'Globe', isInput: true, valueKind: 'string', sections: ['placeholder', 'required', 'default'], logicOperators: TEXT_OPS, defaults: () => base('Website', { placeholder: 'https://' }) }),
  date: def({ type: 'date', category: 'basic', name: 'Date', description: 'Calendar date picker.', icon: 'Calendar', isInput: true, valueKind: 'string', sections: ['required', 'default'], logicOperators: CHOICE_OPS, defaults: () => base('Date') }),
  time: def({ type: 'time', category: 'basic', name: 'Time', description: 'Time of day picker.', icon: 'Clock', isInput: true, valueKind: 'string', sections: ['required', 'default'], logicOperators: CHOICE_OPS, defaults: () => base('Time') }),

  single_choice: def({ type: 'single_choice', category: 'choice', name: 'Single choice', description: 'Pick exactly one option.', icon: 'CircleDot', isInput: true, valueKind: 'string', sections: ['required', 'options', 'allowOther', 'default'], logicOperators: CHOICE_OPS, defaults: () => base('Choose one', { config: { options: [opt('option_1', 'Option 1'), opt('option_2', 'Option 2'), opt('option_3', 'Option 3')] } }) }),
  multiple_choice: def({ type: 'multiple_choice', category: 'choice', name: 'Multiple choice', description: 'Select any number of options.', icon: 'ListChecks', isInput: true, valueKind: 'string_list', sections: ['required', 'options', 'allowOther', 'selections'], logicOperators: LIST_OPS, defaults: () => base('Select all that apply', { config: { options: [opt('option_1', 'Option 1'), opt('option_2', 'Option 2'), opt('option_3', 'Option 3')] } }) }),
  dropdown: def({ type: 'dropdown', category: 'choice', name: 'Dropdown', description: 'Compact list for many options.', icon: 'ChevronDownSquare', isInput: true, valueKind: 'string', sections: ['placeholder', 'required', 'options', 'default'], logicOperators: CHOICE_OPS, defaults: () => base('Select an option', { placeholder: 'Select…', config: { options: [opt('option_1', 'Option 1'), opt('option_2', 'Option 2')] } }) }),
  yes_no: def({ type: 'yes_no', category: 'choice', name: 'Yes / No', description: 'Binary question.', icon: 'ToggleRight', isInput: true, valueKind: 'string', sections: ['required', 'default'], logicOperators: CHOICE_OPS, defaults: () => base('Yes or no?') }),
  rating: def({ type: 'rating', category: 'choice', name: 'Rating', description: 'Stars, hearts or a number scale.', icon: 'Star', isInput: true, valueKind: 'number', sections: ['required', 'rating'], logicOperators: NUM_OPS, defaults: () => base('How would you rate it?', { config: { scale: 5, ratingIcon: 'star' } }) }),
  image_choice: def({ type: 'image_choice', category: 'choice', name: 'Image choice', description: 'Options presented as images.', icon: 'Images', isInput: true, valueKind: 'string_list', sections: ['required', 'options', 'multiple'], logicOperators: LIST_OPS, defaults: () => base('Pick your favourite', { config: { multiple: false, options: [opt('option_1', 'Option A'), opt('option_2', 'Option B')] } }) }),

  attendance: def({ type: 'attendance', category: 'rsvp', name: 'Attendance', description: 'Accept, decline or maybe. Drives RSVP status.', icon: 'CalendarCheck', isInput: true, valueKind: 'string', sections: ['required', 'attendance'], logicOperators: CHOICE_OPS, defaults: () => base('Will you be attending?', { required: true, config: { allowMaybe: false, acceptLabel: 'Joyfully accept', declineLabel: 'Regretfully decline', maybeLabel: 'Maybe' } }) }),
  guest_count: def({ type: 'guest_count', category: 'rsvp', name: 'Guest count', description: 'Number of attendees, optionally adults and children.', icon: 'Users', isInput: true, valueKind: 'guest_count', sections: ['required', 'guestCount'], logicOperators: NUM_OPS, defaults: () => base('How many guests in your party?', { required: true, config: { minGuests: 1, maxGuests: 4, splitAdultsChildren: false } }) }),
  guest_names: def({ type: 'guest_names', category: 'rsvp', name: 'Guest names', description: 'Names of additional attendees.', icon: 'UserPlus', isInput: true, valueKind: 'string_list', sections: ['required', 'guestCount'], logicOperators: LIST_OPS, defaults: () => base('Names of everyone attending', { config: { maxGuests: 4 } }) }),
  plus_one: def({ type: 'plus_one', category: 'rsvp', name: 'Plus-one', description: 'Ask whether a guest brings a companion.', icon: 'HeartHandshake', isInput: true, valueKind: 'plus_one', sections: ['required'], logicOperators: CHOICE_OPS, defaults: () => base('Will you bring a plus-one?') }),
  meal_preference: def({ type: 'meal_preference', category: 'rsvp', name: 'Meal preference', description: 'Meal options for catering counts.', icon: 'UtensilsCrossed', isInput: true, valueKind: 'string', sections: ['required', 'options', 'allowOther'], logicOperators: CHOICE_OPS, defaults: () => base('Meal preference', { config: { options: [opt('vegetarian', 'Vegetarian'), opt('non_vegetarian', 'Non-vegetarian'), opt('vegan', 'Vegan')] } }) }),
  dietary: def({ type: 'dietary', category: 'rsvp', name: 'Dietary restrictions', description: 'Allergies and requirements with notes.', icon: 'Wheat', isInput: true, valueKind: 'dietary', sections: ['required', 'options'], logicOperators: LIST_OPS, defaults: () => base('Any dietary restrictions or allergies?', { config: { options: [opt('gluten_free', 'Gluten-free'), opt('nut_allergy', 'Nut allergy'), opt('dairy_free', 'Dairy-free'), opt('jain', 'Jain'), opt('halal', 'Halal')] } }) }),
  accommodation: def({ type: 'accommodation', category: 'rsvp', name: 'Accommodation', description: 'Does the guest need a room?', icon: 'BedDouble', isInput: true, valueKind: 'string', sections: ['required', 'options'], logicOperators: CHOICE_OPS, defaults: () => base('Do you need accommodation?', { config: { options: [opt('not_needed', 'Not needed'), opt('one_night', 'One night'), opt('two_nights', 'Two nights')] } }) }),
  transportation: def({ type: 'transportation', category: 'rsvp', name: 'Transportation', description: 'Pickup or shuttle requirements.', icon: 'Bus', isInput: true, valueKind: 'string', sections: ['required', 'options'], logicOperators: CHOICE_OPS, defaults: () => base('Will you need transportation?', { config: { options: [opt('none', 'No, I will arrange my own'), opt('airport', 'Airport pickup'), opt('shuttle', 'Venue shuttle')] } }) }),
  event_selection: def({ type: 'event_selection', category: 'rsvp', name: 'Event selection', description: 'Choose which sessions of a multi-part event to attend.', icon: 'CalendarRange', isInput: true, valueKind: 'string_list', sections: ['required', 'options', 'sessions'], logicOperators: LIST_OPS, defaults: () => base('Which events will you attend?', { config: { options: [opt('ceremony', 'Ceremony'), opt('reception', 'Reception')] } }) }),
  rsvp_deadline_info: def({ type: 'rsvp_deadline_info', category: 'rsvp', name: 'RSVP deadline', description: 'Displays the RSVP deadline to guests.', icon: 'AlarmClock', isInput: false, valueKind: 'none', sections: ['content'], defaults: () => base('Kindly respond by', { config: { content: 'Please RSVP before the deadline so we can plan accordingly.' } }) }),

  file_upload: def({ type: 'file_upload', category: 'advanced', name: 'File upload', description: 'Upload documents or images securely.', icon: 'Upload', isInput: true, valueKind: 'files', sections: ['required', 'upload'], logicOperators: ['is_empty', 'is_not_empty'], defaults: () => base('Upload a file', { config: { accept: ['image/*', 'application/pdf'], maxFileSizeMb: 10, maxFiles: 1 } }) }),
  signature: def({ type: 'signature', category: 'advanced', name: 'Signature', description: 'Draw a signature.', icon: 'PenLine', isInput: true, valueKind: 'string', sections: ['required'], logicOperators: ['is_empty', 'is_not_empty'], defaults: () => base('Signature') }),
  address: def({ type: 'address', category: 'advanced', name: 'Address', description: 'Structured postal address.', icon: 'MapPin', isInput: true, valueKind: 'address', sections: ['required'], logicOperators: ['is_empty', 'is_not_empty'], defaults: () => base('Address') }),
  country: def({ type: 'country', category: 'advanced', name: 'Country', description: 'Country selector.', icon: 'Flag', isInput: true, valueKind: 'string', sections: ['placeholder', 'required', 'default'], logicOperators: CHOICE_OPS, defaults: () => base('Country', { placeholder: 'Select country' }) }),
  payment: def({ type: 'payment', category: 'advanced', name: 'Payment', description: 'Collect a fixed amount via the workspace payment provider.', icon: 'CreditCard', isInput: true, valueKind: 'payment', sections: ['payment'], defaults: () => base('Payment', { config: { amount: 500, currency: 'INR' } }) }),
  hidden: def({ type: 'hidden', category: 'advanced', name: 'Hidden field', description: 'Capture a value from the URL or a fixed value.', icon: 'EyeOff', isInput: true, valueKind: 'string', sections: ['hidden'], logicOperators: TEXT_OPS, defaults: () => base('Hidden value', { config: { source: 'query', queryParam: 'ref' } }) }),

  heading: def({ type: 'heading', category: 'content', name: 'Heading', description: 'A title to structure your form.', icon: 'Heading', isInput: false, valueKind: 'none', sections: ['heading'], defaults: () => base('Heading', { config: { level: 2 } }) }),
  paragraph: def({ type: 'paragraph', category: 'content', name: 'Paragraph', description: 'Plain explanatory text.', icon: 'Pilcrow', isInput: false, valueKind: 'none', sections: ['content'], defaults: () => base('', { config: { content: 'Add some helpful context for respondents.' } }) }),
  image: def({ type: 'image', category: 'content', name: 'Image', description: 'Display an image.', icon: 'Image', isInput: false, valueKind: 'none', sections: ['media'], defaults: () => base('', { config: { url: '', alt: '' } }) }),
  video: def({ type: 'video', category: 'content', name: 'Video', description: 'Embed a YouTube or Vimeo video.', icon: 'Video', isInput: false, valueKind: 'none', sections: ['media'], defaults: () => base('', { config: { url: '' } }) }),
  divider: def({ type: 'divider', category: 'content', name: 'Divider', description: 'A horizontal rule.', icon: 'Minus', isInput: false, valueKind: 'none', sections: [], defaults: () => base('') }),
  spacer: def({ type: 'spacer', category: 'content', name: 'Spacer', description: 'Vertical whitespace.', icon: 'MoveVertical', isInput: false, valueKind: 'none', sections: ['spacer'], defaults: () => base('', { config: { height: 32 } }) }),
  section: def({ type: 'section', category: 'content', name: 'Section', description: 'Groups the fields that follow it.', icon: 'LayoutPanelTop', isInput: false, valueKind: 'none', sections: ['content'], defaults: () => base('New section', { config: { content: '' } }) }),
  rich_text: def({ type: 'rich_text', category: 'content', name: 'Rich text', description: 'Formatted text with bold, italics and links.', icon: 'FileText', isInput: false, valueKind: 'none', sections: ['content'], defaults: () => base('', { config: { content: '**Bold**, _italic_ and [links](https://example.com) are supported.' } }) }),
};

export const FIELD_CATEGORIES: { id: FieldCategory; name: string }[] = [
  { id: 'basic', name: 'Basic fields' },
  { id: 'choice', name: 'Choice fields' },
  { id: 'rsvp', name: 'RSVP elements' },
  { id: 'advanced', name: 'Advanced' },
  { id: 'content', name: 'Content' },
];

export function getFieldDefinition(type: FieldType): FieldDefinition {
  return FIELD_DEFINITIONS[type];
}

export function isInputType(type: FieldType): boolean {
  return FIELD_DEFINITIONS[type].isInput;
}

/** Generate a stable, unique element id from a type, e.g. "short_text_3". */
export function generateElementId(type: FieldType, existing: Iterable<string>): string {
  const taken = new Set(existing);
  let n = 1;
  while (taken.has(`${type}_${n}`)) n++;
  return `${type}_${n}`;
}

export function createElement(type: FieldType, existingIds: Iterable<string>): FormElement {
  const d = FIELD_DEFINITIONS[type].defaults();
  return { id: generateElementId(type, existingIds), type, ...d, config: structuredClone(d.config ?? {}) };
}

/** Field types whose answer is used to derive an RSVP status. */
export const RSVP_STATUS_FIELD: FieldType = 'attendance';
