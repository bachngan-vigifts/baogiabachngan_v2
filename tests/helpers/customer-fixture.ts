let sequence=0;
/** Complete fake CRM profile for tests whose purpose is unrelated to required-field validation. */
export function customerCreateFixture<T extends Record<string,unknown>>(overrides:T) {
  const serial=++sequence;
  return {contact:'Liên hệ kiểm thử',phone:String(830000000+serial).padStart(10,'0'),taxCode:String(9900000000+serial),address:'Địa chỉ kiểm thử',...overrides};
}
