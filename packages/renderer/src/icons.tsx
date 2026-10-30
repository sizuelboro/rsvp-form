import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 18, ...p }: P) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const CheckIcon = (p: P) => <svg {...base({ size: 12, strokeWidth: 3, ...p })}><path d="M20 6 9 17l-5-5" /></svg>;
export const StarIcon = ({ filled, ...p }: P & { filled?: boolean }) => <svg {...base({ size: 30, ...p })} fill={filled ? 'currentColor' : 'none'}><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" /></svg>;
export const HeartIcon = ({ filled, ...p }: P & { filled?: boolean }) => <svg {...base({ size: 30, ...p })} fill={filled ? 'currentColor' : 'none'}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>;
export const CalendarIcon = (p: P) => <svg {...base({ size: 16, ...p })}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
export const PinIcon = (p: P) => <svg {...base({ size: 16, ...p })}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>;
export const ClockIcon = (p: P) => <svg {...base({ size: 16, ...p })}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>;
export const UploadIcon = (p: P) => <svg {...base({ size: 22, ...p })}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>;
export const XIcon = (p: P) => <svg {...base({ size: 16, ...p })}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const ArrowLeftIcon = (p: P) => <svg {...base({ size: 16, ...p })}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
export const ArrowRightIcon = (p: P) => <svg {...base({ size: 16, ...p })}><path d="M5 12h14M12 5l7 7-7 7" /></svg>;
export const AlertIcon = (p: P) => <svg {...base({ size: 14, ...p })}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>;
export const LockIcon = (p: P) => <svg {...base({ size: 22, ...p })}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
export const PartyIcon = (p: P) => <svg {...base({ size: 26, ...p })}><path d="M20 6 9 17l-5-5" /></svg>;
export const ImageIcon = (p: P) => <svg {...base({ size: 22, ...p })}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></svg>;
