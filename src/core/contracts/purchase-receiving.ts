import type {SQL,SQLWrapper} from 'drizzle-orm';
/** App-composed assignment predicate; suppliers do not import the tasks module. */
export const purchaseReceivingHooks:{assigned?:(orderId:SQLWrapper,memberId:string)=>SQL}={};
