import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBulkBatteryRows } from './bulkBatteryInitializer';

test('bulk battery rows validate unique serial numbers and required field mapping', () => {
  const rows = [
    { batterySerialNumber: 'P2G-7K5-2409-000001', bmuSerialNumber: 'P2G-BMU-001' },
    { batterySerialNumber: 'P2G-7K5-2409-000002', bmuSerialNumber: 'P2G-BMU-002' },
    { batterySerialNumber: 'P2G-7K5-2409-000003', bmuSerialNumber: 'P2G-BMU-003' },
  ];

  const result = validateBulkBatteryRows(rows);

  assert.equal(result.valid, true);
  assert.equal(result.serials.length, 3);
  assert.deepEqual(result.serials, [
    'P2G-7K5-2409-000001',
    'P2G-7K5-2409-000002',
    'P2G-7K5-2409-000003',
  ]);
});

test('bulk battery rows reject duplicate battery serials', () => {
  const rows = [
    { batterySerialNumber: 'P2G-7K5-2409-000001', bmuSerialNumber: 'P2G-BMU-001' },
    { batterySerialNumber: 'P2G-7K5-2409-000001', bmuSerialNumber: 'P2G-BMU-002' },
  ];

  const result = validateBulkBatteryRows(rows);

  assert.equal(result.valid, false);
  assert.deepEqual(result.duplicates, ['P2G-7K5-2409-000001']);
  assert.match(result.errors.join(' '), /Duplicate battery serial/i);
});
