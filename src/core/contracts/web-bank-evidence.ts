/** Verified bank amount, independent from Woo's paid claim. A legacy timestamp means full payment. */
export type WebBankEvidence=string|{paidAt:string;amount:number;reviewRequired?:boolean};
