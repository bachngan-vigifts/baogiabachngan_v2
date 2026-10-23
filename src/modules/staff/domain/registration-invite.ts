/** Danh tính chờ đăng ký qua link mời (khách / NCC): không phải email đăng nhập được, không cho đặt lại mật khẩu. */
export const INVITE_DOMAIN = '@registration.invalid';
export const isRegistrationInvite = (email: string) => email.endsWith(INVITE_DOMAIN);
