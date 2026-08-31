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

export function normalizeBatteryProductTemplate(product: ProductTemplateLike): ProductTemplateLike {
  const haystack = [product.name, product.productModel, product.batteryName, product.sku]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const is7_5Product =
    haystack.includes('7.5')
    || haystack.includes('7k5')
    || haystack.includes('7_5')
    || Number(product.capacityKwh ?? 0) === 7.5
    || (Number(product.capacityKwh ?? 0) >= 7 && Number(product.capacityKwh ?? 0) <= 8);

  if (!is7_5Product) {
    return product;
  }

  return {
    ...product,
    numModules: 2,
    cellsPerModule: 12,
    totalCells: 24,
    capacityKwh: 7.5,
  };
}

export function resolveBatteryTemplate(products: ProductTemplateLike[], preferredName = '7.5'): ProductTemplateLike {
  const normalized = preferredName.toLowerCase();

  const exactMatch = products.find(product => {
    const haystack = [product.name, product.productModel, product.batteryName, product.sku]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const normalizedProduct = normalizeBatteryProductTemplate(product);

    return (
      normalizedProduct.numModules === 2
      && normalizedProduct.cellsPerModule === 12
      && normalizedProduct.totalCells === 24
      && (
        haystack.includes(normalized)
        || haystack.includes('7k5')
        || haystack.includes('7_5')
        || Number(product.capacityKwh ?? 0) === 7.5
      )
    );
  });

  if (exactMatch) return normalizeBatteryProductTemplate(exactMatch);

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

  if (directMatch) return normalizeBatteryProductTemplate(directMatch);

  const approx = products.find(product => Number(product.capacityKwh ?? 0) >= 7 && Number(product.capacityKwh ?? 0) <= 8);
  if (approx) return normalizeBatteryProductTemplate(approx);

  if (products.length === 0) {
    throw new Error('No product templates were provided for the bulk battery initialization.');
  }

  return normalizeBatteryProductTemplate(products[0]);
}

export function selectAvailableBmUs(items: AvailableBmuLike[], count: number): AvailableBmuLike[] {
  const pool = items.filter(item => {
    const status = String(item.status ?? '').toUpperCase();
    // Include all statuses EXCEPT those that are definitely unavailable
    const unavailableStatuses = ['QUARANTINED', 'FAILED', 'ARCHIVED'];
    return !unavailableStatuses.includes(status) && !item.reservedForBatteryId;
  });

  if (pool.length < count) {
    throw new Error(`Insufficient available BMUs: required ${count}, available ${pool.length}.`);
  }

  return pool.slice(0, count);
}

export function selectRequiredCells(items: AvailableCellLike[], requiredCount: number): AvailableCellLike[] {
  const pool = items.filter(item => {
    const status = String(item.status ?? '').toUpperCase();
    // Include all statuses EXCEPT those that are definitely unavailable
    const unavailableStatuses = ['QUARANTINED', 'REJECTED', 'RESERVED', 'MODULE_ASSIGNED'];
    return !unavailableStatuses.includes(status) && !item.reservedForBatteryId && !item.reservedForOrderId && !item.assignedToModuleId;
  });

  if (pool.length < requiredCount) {
    throw new Error(`Insufficient unallocated cells: required ${requiredCount}, available ${pool.length}.`);
  }

  return pool.slice(0, requiredCount);
}

export function buildModulePlan(
  battery: {
    batterySerial: string;
    cells: { id: string }[];
    bmu?: { id?: string; serialNumber?: string };
  },
  product: ProductTemplateLike,
  productionOrderId: string,
  batteryId: string,
) {
  const cellsPerModule = Math.max(1, product.cellsPerModule || Math.ceil(product.totalCells / Math.max(1, product.numModules)));
  const modules: Array<{
    id: string;
    serialNumber: string;
    qrCode: string;
    productionOrderId: string;
    batteryId: string;
    moduleIndex: number;
    status: string;
    matchingScore: number;
    matchingMetrics: Record<string, number>;
    cellIds: string[];
  }> = [];
  const now = new Date();
  const dateStamp = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (let moduleIndex = 0; moduleIndex < product.numModules; moduleIndex += 1) {
    const start = moduleIndex * cellsPerModule;
    const end = start + cellsPerModule;
    const cellIds = battery.cells.slice(start, end).map(cell => cell.id);
    const moduleNumber = moduleIndex + 1;
    const uniqueSerial = `P2G-MOD-${dateStamp}-${Date.now()}-${String(moduleNumber).padStart(5, '0')}`;

    modules.push({
      id: `mod-${batteryId}-${moduleIndex}`,
      serialNumber: uniqueSerial,
      qrCode: `${uniqueSerial}|${product.sku || product.name || 'BATTERY'}|BATTERY:${battery.batterySerial}`,
      productionOrderId,
      batteryId,
      moduleIndex,
      status: 'CREATED',
      matchingScore: 0,
      matchingMetrics: {
        avgCapacityAh: 0,
        deltaCapacityAh: 0,
        avgOcvV: 0,
        deltaOcvV: 0,
        avgIrMilliOhm: 0,
        deltaIrMilliOhm: 0,
      },
      cellIds,
    });
  }

  return modules;
}

export function buildCompletedBatteryReleasePlan({
  batteryId,
  batterySerial,
  moduleCount,
  bmuId,
  userId,
  createdAt,
}: {
  batteryId: string;
  batterySerial: string;
  moduleCount: number;
  bmuId?: string;
  userId?: string;
  createdAt?: Date;
}) {
  const testTimestamp = createdAt || new Date();
  const moduleTests = Array.from({ length: Math.max(0, moduleCount) * 2 }, (_, index) => ({
    id: `mtest-${batteryId}-${index}`,
    moduleId: `mod-${batteryId}-${Math.floor(index / 2)}`,
    testType: index % 2 === 0 ? 'WELDING_INSPECTION' : 'QC',
    passed: true,
    resultJson: { status: 'PASSED', checkedAt: testTimestamp.toISOString(), checkedBy: userId || 'SYSTEM' },
    remarks: 'Auto-approved for uploaded production batch',
    testedBy: userId || 'SYSTEM',
    testedAt: testTimestamp.toISOString(),
  }));

  const batteryTest = {
    id: `btest-${batteryId}`,
    batteryId,
    testType: 'EOL',
    passed: true,
    resultJson: {
      status: 'PASSED',
      mode: 'AUTO',
      qcTesting: 'PASSED',
      batterySerial,
      checkedAt: testTimestamp.toISOString(),
      checkedBy: userId || 'SYSTEM',
    },
    testedBy: userId || 'SYSTEM',
    testedAt: testTimestamp.toISOString(),
  };

  const release = {
    batteryId,
    status: 'RELEASED',
    currentStep: 'RELEASED',
    progressPercent: 100,
    updatedAt: testTimestamp.toISOString(),
    bmuId,
    releaseNotes: 'Auto-approved for uploaded batch final release',
  };

  return {
    moduleTests,
    batteryTest,
    release,
  };
}

export function dedupeModuleCellAssignments(cellIds: string[]): string[] {
  const seen = new Set<string>();
  return cellIds.filter(cellId => {
    const value = String(cellId ?? '').trim();
    if (!value) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
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
