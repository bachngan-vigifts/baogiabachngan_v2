-- New independent page switch. Preserve access for every existing order-view position,
-- including custom positions; do not grant access to any other page or business API.
INSERT INTO staff_position_permissions(position_id,permission)
SELECT position_id,'page.order-products'
FROM staff_position_permissions
WHERE permission='page.orders' AND position_id NOT IN ('manager','supplier','customer')
ON CONFLICT(position_id,permission) DO NOTHING;
