-- Fix Power2Go 7.5 kWh Template: Update cells configuration
-- This updates the template to use 24 cells per battery (2 modules × 12 cells per module)
-- instead of the current 16 cells configuration

UPDATE public.product_templates
SET 
  cells_per_module = 12,
  num_modules = 2,
  total_cells = 24,
  updated_at = now()
WHERE 
  active = true
  AND (
    name ILIKE '%7.5%' 
    OR capacity_kwh = 7.5 
    OR battery_name ILIKE '%7.5%'
    OR name ILIKE '%Power2Go%'
  );

-- Remove stale duplicate cell-module assignments that were created by the earlier bug.
-- Keep the earliest row for each cell and delete the duplicates.
WITH ranked AS (
  SELECT
    module_id,
    cell_id,
    cell_slot_index,
    assigned_at,
    ROW_NUMBER() OVER (
      PARTITION BY cell_id
      ORDER BY assigned_at ASC NULLS LAST, module_id ASC
    ) AS rn
  FROM public.module_cells
)
DELETE FROM public.module_cells mc
USING ranked r
WHERE mc.module_id = r.module_id
  AND mc.cell_id = r.cell_id
  AND mc.cell_slot_index = r.cell_slot_index
  AND r.rn > 1;

-- Clear stale controller allocations left behind after battery deletions.
UPDATE public.bmu_units
SET reserved_for_battery_id = null,
    status = 'AVAILABLE',
    updated_at = now()
WHERE reserved_for_battery_id IS NOT NULL
  AND reserved_for_battery_id NOT IN (SELECT id FROM public.batteries);

UPDATE public.bms_units
SET reserved_for_battery_id = null,
    status = 'AVAILABLE',
    updated_at = now()
WHERE reserved_for_battery_id IS NOT NULL
  AND reserved_for_battery_id NOT IN (SELECT id FROM public.batteries);

-- Reset cells that are still marked as assigned to invalid or deleted module relationships.
UPDATE public.cells c
SET status = 'AVAILABLE',
    reserved_for_battery_id = null,
    reserved_for_order_id = null,
    updated_at = now()
WHERE c.id IN (
  SELECT mc.cell_id
  FROM public.module_cells mc
  LEFT JOIN public.modules m ON m.id = mc.module_id
  LEFT JOIN public.batteries b ON b.id = m.battery_id
  WHERE m.id IS NULL OR b.id IS NULL
);

-- Verify the update
SELECT id, name, cells_per_module, num_modules, total_cells, capacity_kwh
FROM public.product_templates
WHERE active = true
ORDER BY created_at DESC
LIMIT 5;

SELECT cell_id, COUNT(*)
FROM public.module_cells
GROUP BY cell_id
HAVING COUNT(*) > 1;
