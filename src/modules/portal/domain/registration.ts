/** Pending invitation identity; never a usable email/login or a password-reset account. */
export const INVITE_DOMAIN = '@registration.invalid';
export const isRegistrationInvite = (email: string) => email.endsWith(INVITE_DOMAIN);
export const INVITE_TTL_SECONDS = 24 * 60 * 60;
export type PartnerKind = 'customer' | 'supplier';
