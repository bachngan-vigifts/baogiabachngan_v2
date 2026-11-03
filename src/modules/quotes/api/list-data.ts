import { sql } from 'drizzle-orm';
import { quotations } from '../schema.ts';

/** Totals still use quote-math.ts in JS (including its floating point ordering).
 * Read only its inputs, never images, print layouts or private cost information.
 * Materialize the JSON parse once per document, even for inline-image documents.
 */
export const quoteTotalsData = sql<string>`(
  with document as materialized (select ${quotations.data}::jsonb as value)
  select jsonb_build_object('type', value->'type', 'vat', value->'vat', 'rows',
    coalesce((select jsonb_agg(jsonb_build_object(
      'price', line->'price', 'qty', line->'qty', 'discount', line->'discount',
      'discountType', line->'discountType', 'printFee', line->'printFee', 'taxRate', line->'taxRate'
    ) order by ordinal) from jsonb_array_elements(value->'rows') with ordinality as lines(line, ordinal)), '[]'::jsonb)
  )::text from document
)`;
