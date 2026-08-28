import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const userId = '74c18734-88f5-4aab-b64e-63549f84f27e';
const now = new Date();
const iso = days => new Date(now.getTime() - days * 86400000).toISOString();
async function insert(table, rows) {
  const { error } = await sb.from(table).insert(rows);
  if (error) throw new Error(`${table}: ${error.message}`);
}
async function update(table, values, column, value) {
  const { error } = await sb.from(table).update(values).eq(column, value);
  if (error) throw new Error(`${table}: ${error.message}`);
}

const supplier = { id: 'sup-demo-eve', code: 'DEMO-EVE', name: 'Demo EVE Energy', country: 'Demo', cell_chemistry: 'LFP', nominal_capacity_ah: 108, rating_score: 98 };
const product = {
  id: 'prod-demo-512', sku: 'DEMO-512', name: 'Demo Pack 51.2V', nominal_voltage_v: 51.2,
  capacity_kwh: 5.12, total_capacity_ah: 100, num_modules: 2, cells_per_module: 8, total_cells: 16,
  bms_model: 'Demo BMS', bms_protocol: 'CAN_2_0B',
  bms_config_json: { required: true, model: 'Demo BMS', protocol: 'CAN_2_0B' },
  bmu_config_json: { required: true, model: 'Demo BMU', protocol: 'CAN' },
  grading_rules_json: { minCapacityAh: 90, maxCapacityAh: 120, minOcvV: 3.2, maxOcvV: 3.4, maxIrMilliOhm: 1, maxDeltaCapacityPercent: 5, maxDeltaOcvMv: 5, maxDeltaIrMilliOhm: 0.5 },
  qc_stages: ['OCV_IR'], serial_prefix: 'DEMO-BAT', active: true,
};
const order = {
  id: 'po-demo-001', order_number: 'PO-DEMO-001', product_id: product.id, product_sku: product.sku, product_name: product.name,
  quantity_planned: 2, quantity_completed: 1, quantity_in_process: 1, quantity_failed: 0, status: 'IN_PROCESS',
  required_cells: 32, available_cells: 8, reserved_cells: 16, shortage_cells: 0, required_bms: 2, available_bms: 0, reserved_bms: 2, shortage_bms: 0,
  battery_ids: ['bat-demo-finished', 'bat-demo-process'], created_by: userId, created_at: iso(3), updated_at: iso(0),
};
await insert('suppliers', [supplier]);
await insert('product_templates', [product]);
await insert('production_orders', [order]);
await insert('bms_units', [
  { id: 'bms-demo-001', serial_number: 'DEMO-BMS-001', model: 'Demo BMS', manufacturer: 'Demo Controls', firmware_version: '1.0', hardware_version: 'A', protocol: 'CAN_2_0B', status: 'ASSEMBLED', test_result_json: { status: 'PASSED', canCommsOk: true }, created_at: iso(2) },
  { id: 'bms-demo-002', serial_number: 'DEMO-BMS-002', model: 'Demo BMS', manufacturer: 'Demo Controls', firmware_version: '1.0', hardware_version: 'A', protocol: 'CAN_2_0B', status: 'IN_PROCESS', test_result_json: {}, created_at: iso(1) },
]);
await insert('bmu_units', [
  { id: 'bmu-demo-001', serial_number: 'DEMO-BMU-001', model: 'Demo BMU', manufacturer: 'Demo Controls', protocol: 'CAN', status: 'ONLINE', test_result_json: { status: 'PASSED' }, created_at: iso(2) },
  { id: 'bmu-demo-002', serial_number: 'DEMO-BMU-002', model: 'Demo BMU', manufacturer: 'Demo Controls', protocol: 'CAN', status: 'IN_PROCESS', test_result_json: {}, created_at: iso(1) },
]);
await insert('batteries', [
  { id: 'bat-demo-finished', serial_number: 'DEMO-BAT-001', qr_code: 'DEMO-BAT-001|DEMO-512|PASSED', production_order_id: order.id, product_id: product.id, product_name: product.name, current_step: 'COMPLETED', progress_percent: 100, status: 'FINISHED', modules: [], step_results_json: { FINAL_TESTING: { status: 'PASSED' } }, bms_id: 'bms-demo-001', bmu_id: 'bmu-demo-001', final_qc_result_json: { status: 'PASSED' }, created_at: iso(2), updated_at: iso(1) },
  { id: 'bat-demo-process', serial_number: 'DEMO-BAT-002', qr_code: 'DEMO-BAT-002|DEMO-512|IN_PROCESS', production_order_id: order.id, product_id: product.id, product_name: product.name, current_step: 'MODULE_QC', progress_percent: 62, status: 'IN_PROCESS', modules: [], step_results_json: { FINAL_TESTING: {} }, bms_id: 'bms-demo-002', bmu_id: 'bmu-demo-002', final_qc_result_json: {}, created_at: iso(1), updated_at: iso(0) },
]);
await update('bms_units', { reserved_for_battery_id: 'bat-demo-finished' }, 'id', 'bms-demo-001');
await update('bms_units', { reserved_for_battery_id: 'bat-demo-process' }, 'id', 'bms-demo-002');
await update('bmu_units', { reserved_for_battery_id: 'bat-demo-finished' }, 'id', 'bmu-demo-001');
await update('bmu_units', { reserved_for_battery_id: 'bat-demo-process' }, 'id', 'bmu-demo-002');
const modules = ['finished-a', 'finished-b', 'process-a', 'process-b'].map((suffix, index) => ({
  id: 'mod-demo-' + suffix, serial_number: 'DEMO-MOD-' + String(index + 1).padStart(3, '0'), qr_code: 'DEMO-MOD-' + String(index + 1).padStart(3, '0'), product_id: product.id, production_order_id: order.id,
  battery_id: index < 2 ? 'bat-demo-finished' : 'bat-demo-process', module_index: index % 2, cells: [], matching_score: 90, matching_metrics: {},
  welding_result_json: index < 2 ? { status: 'PASSED' } : {}, qc_result_json: index < 2 ? { status: 'PASSED' } : {}, status: index < 2 ? 'ASSEMBLED' : 'IN_PROCESS', created_at: iso(index), updated_at: iso(index),
}));
await insert('modules', modules);
const cells = [];
for (let i = 1; i <= 48; i++) {
  const damaged = i <= 4;
  const released = i > 4 && i <= 20;
  const active = i > 20 && i <= 40;
  const module = active ? modules[2 + ((i - 21) % 2)] : released ? modules[(i - 5) % 2] : null;
  cells.push({
    id: 'cell-demo-' + String(i).padStart(3, '0'), internal_serial: 'DEMO-CELL-' + String(i).padStart(4, '0'), supplier_barcode: 'DEMO-SCAN-' + String(i).padStart(4, '0'), supplier_id: supplier.id, supplier_name: supplier.name,
    batch_number: 'DEMO-BATCH-01', pallet_number: 'DEMO-PALLET-01', box_number: 'DEMO-BOX-' + String(Math.ceil(i / 12)).padStart(2, '0'), manufacturing_date: '2026-08-01', supplier_capacity_ah: 108, supplier_ocv_v: 3.3, supplier_ir_mohm: 0.26, supplier_grade: damaged ? 'DAMAGED' : 'A', production_ocv_v: damaged ? 3.1 : 3.3, production_ir_mohm: 0.26, production_capacity_ah: 108, production_grade: damaged ? 'DAMAGED' : 'GOOD', tested_at: active || released ? iso(1) : null, tested_by: active || released ? userId : null,
    status: damaged ? 'QUARANTINED' : released ? 'ASSEMBLED' : active ? 'SCANNED' : 'AVAILABLE', reserved_for_order_id: released || active ? order.id : null, reserved_for_battery_id: released ? 'bat-demo-finished' : active ? 'bat-demo-process' : null, assigned_to_module_id: module?.id || null, module_slot_index: module ? (i - 1) % 8 : null, quarantine_reason: damaged ? 'Demo damaged cell' : null, created_at: iso(3), updated_at: iso(0),
  });
}
await insert('cells', cells);
await insert('quarantine_records', cells.slice(0, 4).map((cell, index) => ({ id: '00000000-0000-0000-0000-00000000000' + (index + 1), entity_type: 'CELL', entity_id: cell.id, entity_serial: cell.internal_serial, reason: 'Demo damaged cell', stage: 'GRADING', disposed_of_as: 'REWORK', quarantined_by: userId, quarantined_at: iso(1), status: 'OPEN' })));
await insert('machine_configurations', [
  { id: 'MC-DEMO-OCV', name: 'Demo OCV Station', type: 'OCV_IR_TESTER', ip_address: '192.0.2.10', status: 'ONLINE', last_ping: now.toISOString(), total_runs: 48, success_rate: 98, model: 'DEMO-OCV' },
  { id: 'MC-DEMO-WELD', name: 'Demo Laser Welder', type: 'LASER_WELDER', ip_address: '192.0.2.11', status: 'BUSY', last_ping: now.toISOString(), total_runs: 2, success_rate: 100, model: 'DEMO-WELD' },
]);
await insert('audit_logs', [{ action: 'Demo fixture loaded', entity_type: 'IMPORT', entity_id: 'demo-fixture', user_id: userId, user_name: 'Demo Operator', user_role: 'admin', new_value: { cells: 48, batteries: 2 } }]);
console.log('DEMO FIXTURE INSERTED: 48 cells (8 available, 16 released/reserved, 20 in process, 4 damaged), 2 batteries, 4 modules, 2 BMS, 2 BMU');
