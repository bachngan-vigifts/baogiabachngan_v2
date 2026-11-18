/** Pages are assembled off-Edge. Never publish/cache a partially loaded or mixed-version snapshot. */
export async function fetchCatalogSnapshot(api, have = '') {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const first = await api('/catalog-snapshot?pageSize=500' + (have ? '&v=' + encodeURIComponent(have) : ''));
      if (first.unchanged || first.stockOnly || !first.pagination) return first; // API/UI rollback compatibility.
      const { total, nextOffset } = first.pagination;
      if (!Number.isInteger(total) || total < 0 || total > 1_000_000) throw Error('Invalid catalog page count');
      const rows = [...first.products];
      if (nextOffset !== null) {
        const offsets = []; for (let offset=nextOffset; offset<total; offset+=500) offsets.push(offset);
        // At most two read requests in flight, in the same order as the original server snapshot.
        for (let i=0; i<offsets.length; i+=2) {
          const settled = await Promise.allSettled(offsets.slice(i,i+2).map(offset=>api('/catalog-snapshot?pageSize=500&offset='+offset+'&expectedVersion='+encodeURIComponent(first.version))));
          const failed=settled.find(r=>r.status==='rejected');if(failed)throw failed.reason;
          const pages=settled.map(r=>r.value);
          for (const page of pages) {
            if (page.version!==first.version || !Array.isArray(page.products) || JSON.stringify(page.policies)!==JSON.stringify(first.policies) || JSON.stringify(page.warehouses)!==JSON.stringify(first.warehouses)) {
              const error = Error('Catalog changed between pages'); error.code='CATALOG_SNAPSHOT_CHANGED'; throw error;
            }
            rows.push(...page.products);
          }
        }
      }
      if (rows.length!==total) { const error=Error('Incomplete catalog');error.code='CATALOG_SNAPSHOT_CHANGED';throw error; }
      const { pagination, ...snapshot } = first;
      return {...snapshot,products:rows};
    } catch (error) {
      if (error.code!=='CATALOG_SNAPSHOT_CHANGED' || attempt===2) throw error;
    }
  }
}
