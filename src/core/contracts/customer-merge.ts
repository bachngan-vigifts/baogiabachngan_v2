import type {AnyDb} from '../db/client.ts';
/** App composition attaches references owned by optional modules, inside the merge transaction. */
export type CustomerMergeTx=Parameters<Parameters<AnyDb['transaction']>[0]>[0];
export const customerMergeHooks:{reassign?:(tx:CustomerMergeTx,keepId:string,dropIds:string[])=>Promise<void>}={};
