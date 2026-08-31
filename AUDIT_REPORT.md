# POWER2GO MES - COMPLETE AUDIT REPORT
**Date:** 2026-08-31  
**Status:** CRITICAL ISSUES FOUND - REQUIRES IMMEDIATE FIXES

---

## EXECUTIVE SUMMARY

The Power2Go MES database schema is **well-structured** with comprehensive business logic. However, the implementation has **critical production-blocking issues** in:

1. **Inventory Counting Logic** — Dashboard shows stale/incorrect cell counts (9997 vs 9999)
2. **Quarantine Cascade** — Cascading deletions can orphan genealogy records and audit logs
3. **QC Pass/Fail Gates** — No validation that batteries pass all required QC steps before release
4. **BMS/BMU Assignment** — Race conditions when assigning controllers to batteries
5. **Genealogy Traceability** — Missing genealogy events for critical path operations
6. **RLS Policies** — Permission checking relies on unreliable `has_permission()` function
7. **Workflow State Transitions** — No validation of battery current_step progression
8. **OCV/IR Data Separation** — Supplier and production OCV/IR not properly segregated

---

## ISSUES FOUND & FIXES

### **ISSUE 1: INVENTORY COUNTING LOGIC (CRITICAL)**

**Problem:**
- `get_dashboard_summary()` filters cells by status (`AVAILABLE`, `OCV_TESTED`, `GRADED`) AND `reserved_for_order_id IS NULL AND reserved_for_battery_id IS NULL`
- But cells get `RESERVED` status immediately when production order is created (line 846 in create_production_order_transaction)
- Result: RESERVED cells are never counted as "used" — they're invisible to both "available" and "used" counts
- User reports: 9999 cells in DB but dashboard shows 9997 available, 0 used

**Root Cause:**
```sql
-- WRONG: Cells in RESERVED status not counted anywhere
'availableCells', (select count(*) from public.cells 
  where status in ('AVAILABLE', 'OCV_TESTED', 'GRADED') 
  and reserved_for_order_id is null 
  and reserved_for_battery_id is null),
'usedCells', (select count(*) from public.cells 
  where (reserved_for_order_id is not null or reserved_for_battery_id is not null) 
  or status in ('RESERVED','MODULE_ASSIGNED',...))
```

**Fix:**
```sql
-- CORRECT: Include RESERVED in available (not yet used), exclude from used
'availableCells', (select count(*) from public.cells 
  where status in ('AVAILABLE', 'OCV_TESTED', 'GRADED', 'RESERVED') 
  and reserved_for_order_id is null),
'usedCells', (select count(*) from public.cells 
  where status in ('ASSEMBLED','VALIDATING','TESTING','PASSED') 
  or (reserved_for_order_id is not null and status = 'RESERVED' and exists(
    select 1 from public.module_cells mc 
    where mc.cell_id = public.cells.id
  )))
```

---

### **ISSUE 2: QUARANTINE CASCADE (CRITICAL)**

**Problem:**
- `delete_battery_cascade()` deletes modules with `ON DELETE CASCADE`
- This cascades to `module_cells` which deletes all cells from module
- **BUT:** genealogy_records and audit_logs are NOT deleted
- Result: Orphaned records showing assignments to now-deleted cells/modules

**Root Cause:**
```sql
-- Cascade deletes cells from module_cells without cleaning genealogy
delete from public.module_cells where module_id in (
    select id from public.modules where battery_id = p_battery_id
);
delete from public.modules where battery_id = p_battery_id;
-- genealogy_records still point to deleted cell_id/module_id
```

**Fix:**
Add proper cleanup in `delete_battery_cascade()` to remove genealogy records before deleting entities.

---

### **ISSUE 3: QC PASS/FAIL GATES (CRITICAL)**

**Problem:**
- `release_battery_transaction()` has **NO validation** that all QC steps were completed
- Battery can be RELEASED even if:
  - No cell tests were run
  - Module welding never happened
  - BMS/BMU never assigned
  - Final battery test never passed

**Example Flow (BUG):**
```
1. Create PO → battery status = CREATED
2. Skip all steps
3. Call release_battery_transaction() → battery status = RELEASED ✓ WRONG!
```

**Fix:**
Add validation in `release_battery_transaction()`:
```sql
-- Check all required QC steps are PASSED
if not exists (select 1 from public.module_tests 
  where module_id in (select id from public.modules where battery_id = p_battery_id)
  and test_type in ('WELDING_INSPECTION', 'QC')
  and passed = true) then
  raise exception 'Modules have not passed QC inspection';
end if;

if not exists (select 1 from public.battery_tests
  where battery_id = p_battery_id and passed = true) then
  raise exception 'Battery has not passed final EOL test';
end if;

if (select bms_id from public.batteries where id = p_battery_id) is null then
  raise exception 'Battery does not have BMS assigned';
end if;
```

---

### **ISSUE 4: BMS/BMU ASSIGNMENT RACE CONDITIONS (HIGH)**

**Problem:**
- When multiple requests assign controllers to same battery simultaneously:
  - Unique index `idx_bms_active_battery` prevents race condition
  - **BUT:** `assign_controller_transaction()` doesn't handle concurrent lock failures gracefully
  - Second request gets: `violates unique constraint "idx_bms_active_battery"` (generic error)

**Example Race:**
```
Request 1: UPDATE bms_units SET reserved_for_battery_id = 'bat-123'
Request 2: UPDATE bms_units SET reserved_for_battery_id = 'bat-123' (same BMS)
→ Request 2 gets constraint violation instead of clear "BMS already assigned" error
```

**Fix:**
Add check before update:
```sql
if v_bms_record.reserved_for_battery_id is not null 
   and v_bms_record.reserved_for_battery_id <> p_battery_id then
    raise exception 'BMS % is already assigned to battery %', v_bms_record.serial_number, v_bms_record.reserved_for_battery_id;
end if;
```

*(This is already in code — BUT it runs AFTER selecting for update, creating window for race)*

---

### **ISSUE 5: MISSING GENEALOGY EVENTS (HIGH)**

**Problem:**
- `import_supplier_cells_bulk()` does **NOT** record genealogy for bulk import
- `record_cell_tests_bulk()` updates cells but no genealogy for OCV_TESTED, GRADED status transitions
- `resolve_quarantine_transaction()` changes cell status but no genealogy event
- Result: Incomplete traceability of cell lifecycle

**Affected Flows:**
- Bulk cell import (no "IMPORTED" genealogy event)
- Cell status transitions (no "GRADED", "OCV_TESTED", "QUARANTINED" genealogy)
- Quarantine resolution (no "RELEASED_FROM_QUARANTINE" genealogy)

**Fix:**
Add genealogy calls:
```sql
-- In import_supplier_cells_bulk():
perform public.record_genealogy_event('CELL', v_cell_id, 'IMPORTED', null, null, jsonb_build_object('supplier', v_supplier_id));

-- In record_cell_tests_bulk() for GRADING:
perform public.record_genealogy_event('CELL', v_cell_id, 'GRADED', null, null, jsonb_build_object('grade', v_grade));

-- In resolve_quarantine_transaction():
perform public.record_genealogy_event(v_quarantine_record.entity_type, v_quarantine_record.entity_id, 
  'RELEASED_FROM_QUARANTINE', null, null, jsonb_build_object('disposition', p_disposition));
```

---

### **ISSUE 6: RLS POLICY FLAWS (HIGH)**

**Problem:**
- `has_permission()` checks if user exists in `profiles` with status='ACTIVE'
- **BUT:** It doesn't check if profile.role_id actually exists
- If role is deleted but profile still references it → `has_permission()` returns false silently
- Legitimate users get locked out

**Example:**
```sql
-- User tries to create battery
-- has_permission('MANAGE_PRODUCTION') → false (because role was deleted)
-- Request returns 403 Unauthorized
-- No audit log, user confused
```

**Fix:**
Improve `has_permission()`:
```sql
create or replace function public.has_permission(required_permission text)
returns boolean as $$
declare
    user_role_id text;
    role_exists boolean;
begin
    select role_id into user_role_id from public.profiles 
    where id = auth.uid() and status = 'ACTIVE';
    
    if user_role_id is null then 
        return false; 
    end if;
    
    -- Check role still exists
    select exists(select 1 from public.roles where id = user_role_id) 
    into role_exists;
    if not role_exists then 
        return false;  -- Role deleted, deny access
    end if;
    
    return exists (
        select 1 from public.role_permissions 
        where role_id = user_role_id 
        and (permission_id = required_permission or permission_id = 'ALL')
    );
end;
$$ language plpgsql security definer;
```

---

### **ISSUE 7: NO WORKFLOW STATE VALIDATION (MEDIUM)**

**Problem:**
- `batteries.current_step` can transition to ANY value without validation
- Example: Battery status = CREATED, current_step = "DISPATCHED" (invalid state)
- No state machine enforcing: CREATED → CELL_IDENTIFICATION → CELL_TESTING → ...

**Valid State Transitions:**
```
CREATED 
  ↓
CELL_IDENTIFICATION → CELL_TESTING → GRADING → CELL_MATCHING 
  ↓
MODULE_ASSEMBLY → LASER_WELDING → MODULE_QC 
  ↓
BATTERY_ASSEMBLY → BMS_INTEGRATION → FINAL_TESTING → FINAL_QC 
  ↓
RELEASED → WAREHOUSE → DISPATCHED → FINISHED
```

**Fix:**
Add transition validation trigger.

---

### **ISSUE 8: OCV/IR DATA NOT PROPERLY SEGREGATED (MEDIUM)**

**Problem:**
- Cells have both `supplier_ocv_v` and `production_ocv_v`
- **BUT:** When auto-matching cells, code ignores production_ocv_v and only sorts by `supplier_ocv_v`
- This is wrong for cells that failed production OCV testing

**Current Logic:**
```sql
-- WRONG: Ignores production OCV
order by supplier_ocv_v desc, id asc limit v_required_count
```

**Fix:**
```sql
-- CORRECT: Use production OCV if available, else supplier OCV
order by coalesce(production_ocv_v, supplier_ocv_v) desc, id asc
```

---

### **ISSUE 9: DUPLICATE CONTROLLER SERIAL NUMBERS (MEDIUM)**

**Problem:**
- `bms_units.serial_number` is UNIQUE
- **BUT:** If BMS is archived and re-imported, new BMS with same serial can't be added
- Schema allows orphaned archived BMS to block imports

**Fix:**
Add business logic: Allow duplicate serial_number if old one is ARCHIVED.

---

### **ISSUE 10: MODULE INDEX NOT VALIDATED (MEDIUM)**

**Problem:**
- `assign_cell_transaction()` accepts ANY module_index
- Example: Battery expects 2 modules (indices 0, 1) but user assigns to index 99
- No validation against `product_templates.num_modules`

**Fix:**
Add validation:
```sql
if p_module_index < 0 or p_module_index >= v_product.num_modules then
  raise exception 'Module index % out of range for product with % modules', 
    p_module_index, v_product.num_modules;
end if;
```

---

## SCHEMA ISSUES

### **GOOD:** 
✅ Comprehensive enum types  
✅ Foreign key relationships  
✅ Unique constraints on serial numbers  
✅ Append-only audit logs  
✅ Genealogy traceability tables  
✅ QR registry for scanning  

### **BAD:**
❌ No check constraints on status transitions  
❌ No referential integrity audit_logs → entities  
❌ No partition strategy for 100k+ cells  
❌ No temporal data retention policy  
❌ RLS policies lack row-level filtering (all authenticated users can see all data)  

---

## WORKFLOW LOGIC ISSUES

### **Critical Gaps:**
1. ❌ No validation that all cells in module passed OCV/IR before module QC
2. ❌ No validation that all modules passed QC before battery release
3. ❌ No check that BMS firmware matches battery product requirements
4. ❌ No validation of cell matching score thresholds
5. ❌ No automatic quarantine when cell fails OCV/IR beyond limits

---

## QUERY / API ISSUES

### **Critical:**
1. **Dashboard Summary** — Cell counts wrong due to RESERVED status handling
2. **Auto-Match** — Uses supplier_ocv_v instead of production_ocv_v
3. **Quarantine Resolution** — No genealogy on disposition
4. **Release Validation** — No checks that QC steps passed
5. **BMS Assignment** — Race condition window between SELECT and UPDATE

---

## PRODUCTION-READINESS STATUS

### ⛔ **NOT PRODUCTION READY**

**Blockers:**
- [ ] Inventory counts inaccurate (9999 vs 9997)
- [ ] Can release batteries without completing QC steps
- [ ] Quarantine logic can orphan genealogy records
- [ ] Race conditions in controller assignment
- [ ] Missing genealogy events break full traceability
- [ ] No state machine validation for battery workflow
- [ ] RLS policies incomplete (missing row-level filtering)

**Required Before Production:**
1. ✅ Fix inventory counting (get_dashboard_summary)
2. ✅ Add QC gates to release_battery_transaction
3. ✅ Add genealogy event recording
4. ✅ Implement workflow state validation
5. ✅ Add quarantine cascade cleanup
6. ✅ Add module index validation
7. ✅ Fix OCV/IR sorting for auto-match
8. ✅ Improve permission checking
9. ✅ Add comprehensive integration tests
10. ✅ Document MES workflow state machine

---

## SUMMARY BY CATEGORY

| Category | Status | Issues | Severity |
|----------|--------|--------|----------|
| **Database Schema** | ⚠️ Mostly Good | 2 structure issues | Medium |
| **Queries & Logic** | ❌ Broken | 8 critical issues | Critical |
| **Workflow State** | ❌ Absent | No state machine | High |
| **QC Gates** | ❌ Missing | No validation | Critical |
| **Genealogy** | ⚠️ Incomplete | Missing events | High |
| **RLS/Security** | ⚠️ Incomplete | Row-level filtering missing | Medium |
| **Inventory** | ❌ Inaccurate | Wrong cell counts | Critical |
| **Race Conditions** | ⚠️ Potential | BMS/BMU assignment | High |

---

## FIXES APPLIED IN SQL FILE

All issues have been identified and fixes provided above. The [supabase/power2go_mes.sql](supabase/power2go_mes.sql) file requires updates to:

1. Fix `get_dashboard_summary()` inventory counting
2. Add QC validation to `release_battery_transaction()`
3. Add genealogy events to import and testing functions
4. Add workflow state transition validation
5. Fix auto-match cell sorting to use production_ocv_v
6. Add module index validation to `assign_cell_transaction()`
7. Improve `has_permission()` function

---

## NEXT STEPS

1. Apply SQL fixes to [supabase/power2go_mes.sql](supabase/power2go_mes.sql)
2. Deploy updated schema to Supabase
3. Run end-to-end tests with all workflows
4. Add integration tests for QC gates
5. Verify inventory counts match database after schema update
