/** Pending invitation identity; never a usable email/login or a password-reset account (định nghĩa ở staff – staff không import portal). */
export { INVITE_DOMAIN, isRegistrationInvite } from '../../staff/domain/registration-invite.ts';
export const INVITE_TTL_SECONDS = 24 * 60 * 60;
export type PartnerKind = 'customer' | 'supplier';
