import {fold} from '../../../core/text/fold.ts';

/** Company-confirmed receiving account for official VG contract numbers. */
export const VG_SEPAY_ACCOUNT = '159063909';
export function defaultSepayCrmAccount(contractNo?: string | null): string | null {
  const no = fold(contractNo || '').replace(/\s+/g,'');
  return /(?:^|\/)hdkt\/vg-[a-z0-9]/.test(no) ? VG_SEPAY_ACCOUNT : null;
}
