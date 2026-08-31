# 🚀 DEPLOYMENT GUIDE - Power2Go MES Schema & Battery Generation

## ⚠️ CRITICAL: Manual Schema Deployment Required

The schema file has been updated with **7 critical fixes**. These must be deployed to your live Supabase instance before the battery generator can run.

---

## STEP 1: Backup Supabase Database

**Time: 5 minutes**

1. Go to: https://app.supabase.com/project/qrpwwalebkydaumwxlpd/settings/backups
2. Click **"Create Backup Now"**
3. Wait for completion (shows "Success" message)

✅ Backup created successfully

---

## STEP 2: Deploy Schema to Supabase

**Time: 5-10 minutes**

### Option A: Manual SQL Editor (Recommended)

1. Open Supabase SQL Editor:
   https://app.supabase.com/project/qrpwwalebkydaumwxlpd/sql/new

2. Open the schema file:
   ```
   supabase/power2go_mes.sql
   ```

3. Copy **ALL** content from the file

4. Paste into Supabase SQL Editor (clear any existing content)

5. Click **"Run"** button or press `Ctrl+Enter` (or `Cmd+Enter` on Mac)

6. Wait for message: **"Query successful"** ✅

### Option B: Terminal Script (If Available)

```bash
# First check environment
cat .env | grep SUPABASE_SERVICE_ROLE_KEY

# Run deployment (requires manual confirmation in SQL editor)
node scripts/deploy-schema.mjs
```

---

## STEP 3: Verify Deployment

After manual SQL deployment is complete, verify it worked:

```bash
# Open a PowerShell terminal and run:
npm run test:live
```

Expected output:
```
✅ Connected to Supabase
✓ get_dashboard_summary - EXISTS
✓ import_supplier_cells_bulk - EXISTS  
✓ auto_match_cells_transaction - EXISTS
✓ release_battery_transaction - EXISTS
   Total Cells: 9999
   Available Cells: 9999
   Used Cells: 0
```

---

## STEP 4: Create 50 Batteries

**Time: 2-5 minutes**

After schema deployment is verified, run the battery generator:

```bash
# From project root directory:
node scripts/create-50-batteries.mjs
```

This will create:
- ✅ 30 batteries of 5.12 kWh (2 modules × 8 cells = 16 cells each)
- ✅ 20 batteries of 7.5 kWh (2 modules × 12 cells = 24 cells each)
- ✅ Total: 50 batteries using 960 cells

Expected output:
```
✓ Creating 30 × 5.12 kWh batteries...
   ✓ Order PO-5K12-001-XXXXXX
   ✓ Order PO-5K12-002-XXXXXX
   ...
✓ Creating 20 × 7.5 kWh batteries...
   ✓ Order PO-7K5-001-XXXXXX
   ...
✅ Battery creation complete!
📊 Summary:
   • Total batteries created: 50 of 50
   • Total cells allocated: ~960
```

---

## STEP 5: Verify Battery Creation

After batteries are created, verify them in Supabase:

1. Open Supabase: https://app.supabase.com/project/qrpwwalebkydaumwxlpd/editor
2. Click **"batteries"** table
3. You should see 50 new rows with statuses like "CREATED" or "CELL_IDENTIFICATION"

Or run a quick query:
```sql
-- In Supabase SQL Editor:
SELECT COUNT(*) as total_batteries FROM batteries;
SELECT COUNT(*) as reserved_cells FROM cells WHERE status = 'RESERVED';
```

Expected results:
- `total_batteries`: Should be ≥ 50 (might have existing batteries)
- `reserved_cells`: Should be ~960

---

## What Was Fixed in the Schema

✅ **Inventory Counting** — Now correctly shows 9999 available cells  
✅ **QC Gates** — Batteries cannot be released without:
  - All modules passing QC inspection
  - BMS or BMU assigned
  - Final EOL test passed

✅ **Genealogy Events** — Full traceability of cell lifecycle  
✅ **Cell Sorting** — Uses production OCV values (not supplier)  
✅ **Permission Checking** — Validates roles still exist  
✅ **Quarantine Cascade** — Proper cleanup of relationships  
✅ **Module Index Validation** — Prevents invalid module assignments  

---

## Troubleshooting

### Error: "Query failed"
**Cause:** Syntax error in SQL  
**Solution:**
- Make sure you copied the ENTIRE file
- Check for missing line breaks in function definitions
- Try re-copying and pasting

### Error: "relation 'X' does not exist"
**Cause:** Referenced table was deleted  
**Solution:**
- This is usually safe to ignore
- The table will be recreated by the SQL script

### Error: "duplicate key value"
**Cause:** Object already exists in database  
**Solution:**
- Safe to ignore
- Objects are being recreated with updates

### Error when running battery generator: "RPC function not found"
**Cause:** Schema not deployed to Supabase yet  
**Solution:**
- Go back to Step 2 and deploy the schema manually
- Then try the battery generator again

### Only 25 batteries created instead of 50
**Cause:** Not enough available cells  
**Solution:**
- Check: `SELECT COUNT(*) FROM cells WHERE status IN ('AVAILABLE', 'IMPORTED', 'OCV_TESTED', 'GRADED')`
- Should be ≥ 960 cells available
- If less than 960, some cells might be reserved/quarantined

---

## Timeline

| Step | Action | Time | Status |
|------|--------|------|--------|
| 1 | Backup database | 5 min | ⏳ Do this first |
| 2 | Deploy schema to Supabase | 10 min | ⏳ Manual SQL Editor |
| 3 | Verify deployment | 2 min | ⏳ Run test command |
| 4 | Generate 50 batteries | 5 min | ⏳ Run script |
| 5 | Verify results | 2 min | ⏳ Check Supabase |
| **Total** | **Complete deployment** | **~25 min** | ✅ |

---

## After Deployment

Once everything is deployed:

✅ Dashboard will show correct inventory (9999 cells, now allocating 960)  
✅ Battery release requires QC gates (safer operations)  
✅ Full genealogy trail for compliance  
✅ Production system is ready for your real cell data  

### Next: Import Your Own Cells

When ready to use real data:
```bash
# Use the supplier import function to upload your cells
# See: src/components/supplier/SupplierImportView.tsx
```

---

## Questions?

- 📖 Detailed audit: [AUDIT_FIXES_SUMMARY.md](AUDIT_FIXES_SUMMARY.md)
- 🗂️ Database schema: [supabase/power2go_mes.sql](supabase/power2go_mes.sql)
- 🔧 Fixes applied: Lines marked with `-- FIXED:` in SQL file

---

**Status: Ready for schema deployment** ✅

*All SQL fixes have been prepared. Manual deployment to Supabase required.*
