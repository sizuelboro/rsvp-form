import {
  AlarmClock, AlignLeft, BedDouble, Bus, Calendar, CalendarCheck, CalendarRange, ChevronDownSquare, CircleDot, Clock, CreditCard, EyeOff,
  FileText, Flag, Globe, Hash, Heading, HeartHandshake, Image, Images, LayoutPanelTop, ListChecks, Mail, MapPin, Minus, MoveVertical,
  PenLine, Phone, Pilcrow, Star, ToggleRight, Type, Upload, UserPlus, Users, UtensilsCrossed, Video, Wheat, type LucideIcon,
} from 'lucide-react';

/** Explicit map (instead of dynamic lookup) so unused icons are tree-shaken. Keys match FIELD_DEFINITIONS[*].icon. */
export const FIELD_ICONS: Record<string, LucideIcon> = {
  Type, AlignLeft, Mail, Phone, Hash, Globe, Calendar, Clock, CircleDot, ListChecks, ChevronDownSquare, ToggleRight, Star, Images,
  CalendarCheck, Users, UserPlus, HeartHandshake, UtensilsCrossed, Wheat, BedDouble, Bus, CalendarRange, AlarmClock,
  Upload, PenLine, MapPin, Flag, CreditCard, EyeOff, Heading, Pilcrow, Image, Video, Minus, MoveVertical, LayoutPanelTop, FileText,
};
