export type BulkBatteryRow = {
  batterySerialNumber?: string;
  bmuSerialNumber?: string;
  [key: string]: any;
};

export type BulkBatteryValidationResult = {
  valid: boolean;
  serials: string[];
  duplicates: string[];
  errors: string[];
};

export type ProductTemplateLike = {
  id: string;
  name: string;
  productModel?: string;
  batteryName?: string;
  sku?: string;
  capacityKwh?: number;
  totalCells: number;
  numModules: number;
  cellsPerModule: number;
};

export type AvailableBmuLike = {
  id: string;
  serialNumber: string;
  status?: string;
  reservedForBatteryId?: string | null;
};

export type AvailableCellLike = {
  id: string;
  internalSerial: string;
  status?: string;
  reservedForBatteryId?: string | null;
  reservedForOrderId?: string | null;
  assignedToModuleId?: string | null;
};

export function normalizeBatterySerial(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

export function validateBulkBatteryRows(rows: BulkBatteryRow[]): BulkBatteryValidationResult {
  const serials: string[] = [];
  const duplicates = new Set<string>();
  const errors: string[] = [];

  for (const [index, row] of rows.entries()) {
    const value = normalizeBatterySerial(row?.batterySerialNumber ?? '');
    if (!value) {
      errors.push(`Row ${index + 2}: missing battery serial number`);
      continue;
    }

    if (serials.includes(value)) {
      duplicates.add(value);
      errors.push(`Duplicate battery serial detected: ${value}`);
      continue;
    }

    serials.push(value);
  }

  if (duplicates.size > 0) {
    errors.push(`Duplicate battery serial(s): ${Array.from(duplicates).join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    serials,
    duplicates: Array.from(duplicates),
    errors,
  };
}

export function resolveBatteryTemplate(products: ProductTemplateLike[], preferredName = '7.5'): ProductTemplateLike {
  const normalized = preferredName.toLowerCase();
  const directMatch = products.find(product => {
    const haystack = [product.name, product.productModel, product.batteryName, product.sku]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalized)
      || haystack.includes('7k5')
      || haystack.includes('7_5')
      || product.capacityKwh === 7.5;
  });

  if (directMatch) return directMatch;

  const approx = products.find(product => Number(product.capacityKwh ?? 0) >= 7 && Number(product.capacityKwh ?? 0) <= 8);
  if (approx) return approx;

  if (products.length === 0) {
    throw new Error('No product templates were provided for the bulk battery initialization.');
  }

  return products[0];
}

export function selectAvailableBmUs(items: AvailableBmuLike[], count: number): AvailableBmuLike[] {
  const pool = items.filter(item => {
    const status = String(item.status ?? '').toUpperCase();
    return status === 'AVAILABLE' || status === 'READY' || (!item.reservedForBatteryId && status !== 'QUARANTINED');
  });

  if (pool.length < count) {
    throw new Error(`Insufficient available BMUs: required ${count}, available ${pool.length}.`);
  }

  return pool.slice(0, count);
}

export function selectRequiredCells(items: AvailableCellLike[], requiredCount: number): AvailableCellLike[] {
  const pool = items.filter(item => {
    const status = String(item.status ?? '').toUpperCase();
    return status === 'AVAILABLE' || status === 'IMPORTED' || status === 'OCV_TESTED' || status === 'GRADED' || status === 'ACKNOWLEDGED';
  });

  if (pool.length < requiredCount) {
    throw new Error(`Insufficient unallocated cells: required ${requiredCount}, available ${pool.length}.`);
  }

  return pool.slice(0, requiredCount);
}

export async function createBulkBatteryInitialization({
  rows,
  products,
  availableBmUs,
  availableCells,
  userId,
}: {
  rows: BulkBatteryRow[];
  products: ProductTemplateLike[];
  availableBmUs: AvailableBmuLike[];
  availableCells: AvailableCellLike[];
  userId?: string;
}) {
  const validation = validateBulkBatteryRows(rows);
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '));
  }

  if (rows.length === 0) {
    throw new Error('No battery rows were provided for initialization.');
  }

  const productTemplate = resolveBatteryTemplate(products, '7.5');
  const requiredBmuCount = rows.length;
  const bmuPool = selectAvailableBmUs(availableBmUs, requiredBmuCount);
  const totalRequiredCells = productTemplate.totalCells * rows.length;
  const selectedCells = selectRequiredCells(availableCells, totalRequiredCells);

  const batteryPlan = rows.map((row, index) => {
    const batterySerial = normalizeBatterySerial(row.batterySerialNumber ?? '');
    const assignedBmu = bmuPool[index];
    const cellStart = index * productTemplate.totalCells;
    const cellSlice = selectedCells.slice(cellStart, cellStart + productTemplate.totalCells);
    if (cellSlice.length !== productTemplate.totalCells) {
      throw new Error(`Battery ${batterySerial} could not allocate the required ${productTemplate.totalCells} cells.`);
    }

    const moduleAssignments = Array.from({ length: productTemplate.numModules }, (_, moduleIndex) => ({
      moduleIndex,
      cells: cellSlice.slice(moduleIndex * productTemplate.cellsPerModule, (moduleIndex + 1) * productTemplate.cellsPerModule),
    }));

    return {
      rowIndex: index + 2,
      batterySerial,
      bmu: assignedBmu,
      cells: cellSlice,
      modules: moduleAssignments,
      genealogy: {
        batterySerial,
        bmuId: assignedBmu?.id,
        bmuSerial: assignedBmu?.serialNumber,
        cellIds: cellSlice.map(cell => cell.id),
      },
    };
  });

  return {
    valid: true,
    batchSize: rows.length,
    template: productTemplate,
    order: {
      type: 'BULK_BATTERY_INITIALIZATION',
      productId: productTemplate.id,
      quantity: rows.length,
      productName: productTemplate.name,
      requiredCells: totalRequiredCells,
      requiredBmUs: requiredBmuCount,
    },
    batteries: batteryPlan,
    validation,
  };
}
