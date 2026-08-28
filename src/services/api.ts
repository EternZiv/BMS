import {
  ProductTemplate,
  Supplier,
  CellItem,
  BMSItem,
  BMUItem,
  ModuleItem,
  BatteryUnit,
  ProductionOrder,
  MachineStation,
  AuditLog,
  QuarantineRecord,
  SupplierImportSummary,
  User,
  Role,
  AuditLog as AuditLogType,
} from '../types';

import { supabase as rawSupabase } from '../lib/supabaseBrowser';

const columnAliases: Record<string, string> = {
  bmsConfig: 'bms_config_json',
  bmuConfig: 'bmu_config_json',
  gradingRules: 'grading_rules_json',
  qcStages: 'qc_stages',
  supplierIrMilliOhm: 'supplier_ir_mohm',
  productionIrMilliOhm: 'production_ir_mohm',
  testResult: 'test_result_json',
  stepResults: 'step_results_json',
  finalQcResult: 'final_qc_result_json',
  weldingResult: 'welding_result_json',
  qcResult: 'qc_result_json',
  assignedToBatteryId: 'reserved_for_battery_id',
  disposition: 'disposed_of_as',
  dispositionNotes: 'disposition_notes',
};

const reverseColumnAliases = Object.fromEntries(
  Object.entries(columnAliases).map(([appName, dbName]) => [dbName, appName]),
);

function toDbColumn(value: string) {
  return columnAliases[value] || value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function toAppColumn(value: string) {
  if (reverseColumnAliases[value]) return reverseColumnAliases[value];
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toDbRow(row: any, table?: string) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const mapped = Object.fromEntries(Object.entries(row).map(([key, value]) => [toDbColumn(key), value]));
  if (table === 'audit_logs' || table === 'quarantine_records') {
    delete mapped.id;
    delete mapped.user_id;
    delete mapped.quarantined_by;
    delete mapped.resolved_by;
  }
  return mapped;
}

function toAppValue(value: any): any {
  if (Array.isArray(value)) return value.map(toAppValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [toAppColumn(key), toAppValue(child)]));
}

function mapQueryValue(method: string, value: any, index: number) {
  if (typeof value !== 'string') return value;
  if (method === 'eq' || method === 'neq' || method === 'in' || method === 'ilike') {
    return index === 0 ? toDbColumn(value) : value;
  }
  if (method === 'select' || method === 'order') {
    return index === 0 ? value.replace(/[A-Za-z][A-Za-z0-9]*(?=\.|,|\s|$)/g, token => toDbColumn(token)) : value;
  }
  if (method === 'or' || method === 'and') {
    return value.replace(/([A-Za-z][A-Za-z0-9_]*)\.(?=(?:eq|neq|gt|gte|lt|lte|like|ilike|is)\.)/g, (_, token) => `${toDbColumn(token)}.`);
  }
  return value;
}

function wrapSupabaseQuery(query: any, table: string): any {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === 'then') {
        return (resolve: any, reject: any) => target.then((result: any) => resolve({ ...result, data: toAppValue(result.data) }), reject);
      }
      const original = Reflect.get(target, property, receiver);
      if (typeof original !== 'function') return original;
      return (...args: any[]) => {
        const method = String(property);
        const mappedArgs = args.map((arg, index) => {
          if (['insert', 'update', 'upsert'].includes(method) && index === 0) {
            return Array.isArray(arg) ? arg.map(value => toDbRow(value, table)) : toDbRow(arg, table);
          }
          return mapQueryValue(method, arg, index);
        });
        return wrapSupabaseQuery(original.apply(target, mappedArgs), table);
      };
    },
  });
}

const supabaseDb = {
  from(table: string) {
    return wrapSupabaseQuery((rawSupabase as any).from(table), table);
  },
};

const supabase = Object.assign(supabaseDb, { auth: (rawSupabase as any)?.auth });

const handleError = (res: Response) => {
  if (res.status === 401) {
    const text = res.statusText;
    const err: any = new Error('Authentication required. Session expired or invalid.');
    err.name = 'AuthRequiredError';
    err.status = res.status;
    err.detail = text;
    throw err;
  }
  if (res.status === 403) {
    const text = res.statusText;
    const err: any = new Error('Permission denied.');
    err.name = 'PermissionDeniedError';
    err.status = res.status;
    err.detail = text;
    throw err;
  }
  if (!res.ok) {
    const text = res.statusText;
    const err: any = new Error(text || 'Request failed');
    err.name = 'ApiError';
    err.status = res.status;
    err.detail = text;
    throw err;
  }
  return res.json();
};

function mapSupabaseProfile(raw: any): User {
  return {
    id: raw.id,
    name: raw.full_name || raw.email?.split('@')[0] || 'Operator',
    username: raw.username || raw.email?.split('@')[0] || 'operator',
    email: raw.email || '',
    roleId: raw.role_id,
    role: raw.role?.name || 'operator',
    badgeId: raw.badge_id || '',
    status: raw.status || 'ACTIVE',
  };
}

export const api = {
  // Users & Roles

async getUsers(): Promise<User[]> {
    const { data, error } = await supabaseDb.from('profiles').select(`
      id, full_name, email, username, role_id, status, badge_id, created_at, updated_at,
      role:roles (id, name, description, status)
    `).order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapSupabaseProfile);
  },

  async createUser(user: Partial<User>, userId?: string): Promise<User> {
    const { data: sessionData } = await rawSupabase?.auth.getSession() || { data: { session: null } };
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {}),
      },
      body: JSON.stringify({ ...user, userId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not create user');
    return result;
  },

  async updateUser(id: string, user: Partial<User>, userId?: string): Promise<User> {
    if (user.roleId && !['role-admin', 'role-operator'].includes(user.roleId)) {
      throw new Error('Users may only be assigned Administrator or Operator.');
    }
    const { data, error } = await supabase.from('profiles').update({
      full_name: user.name || undefined,
      email: user.email || undefined,
      username: user.username || undefined,
      role_id: user.roleId || undefined,
      badge_id: user.badgeId || undefined,
      status: user.status || undefined,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select();
    if (error) throw error;
    return data?.[0] || {};
  },

  async deleteUser(id: string, userId?: string): Promise<any> {
    const { data: sessionData } = await rawSupabase?.auth.getSession() || { data: { session: null } };
    const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {}),
      },
      body: JSON.stringify({ userId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete user');
    return result;
  },

  async getRoles(): Promise<Role[]> {
    const [{ data: roles, error: rolesError }, { data: grants, error: grantsError }] = await Promise.all([
      supabase.from('roles').select('*').order('created_at', { ascending: false }),
      supabase.from('role_permissions').select('role_id, permission_id'),
    ]);
    if (rolesError) throw rolesError;
    if (grantsError) throw grantsError;
    const permissionsByRole = new Map<string, string[]>();
    (grants || []).forEach((grant: any) => {
      const permissions = permissionsByRole.get(grant.roleId) || [];
      permissions.push(grant.permissionId);
      permissionsByRole.set(grant.roleId, permissions);
    });
    return (roles || []).filter((role: any) => ['role-admin', 'role-operator'].includes(role.id)).map((role: any) => ({
      ...role,
      permissions: role.permissions?.includes('ALL')
        ? ['ALL']
        : permissionsByRole.get(role.id) || role.permissions || [],
    }));
  },

  async createRole(role: Partial<Role>, userId?: string): Promise<Role> {
    throw new Error('Only Administrator and Operator roles are supported.');
  },

  async updateRole(id: string, role: Partial<Role>, userId?: string): Promise<Role> {
    if (!['role-admin', 'role-operator'].includes(id)) {
      throw new Error('Only Administrator and Operator roles are supported.');
    }
    const { data, error } = await supabase.from('roles').update({
      name: role.name || undefined,
      description: role.description || undefined,
      status: role.status || undefined,
      updatedAt: new Date().toISOString(),
    }).eq('id', id).select();
    if (error) throw error;
    if (role.permissions) await this.replaceRolePermissions(id, role.permissions);
    return { ...(data?.[0] || {}), permissions: role.permissions || [] };
  },

  async replaceRolePermissions(roleId: string, permissions: string[]): Promise<void> {
    const { error: deleteError } = await supabase.from('role_permissions').delete().eq('roleId', roleId);
    if (deleteError) throw deleteError;
    if (permissions.length === 0 || permissions.includes('ALL')) {
      if (permissions.includes('ALL')) {
        const { error } = await supabase.from('role_permissions').insert({ roleId, permissionId: 'ALL' });
        if (error) throw error;
      }
      return;
    }
    const { error } = await supabase.from('role_permissions').insert(
      permissions.map(permissionId => ({ roleId, permissionId })),
    );
    if (error) throw error;
  },

  async deleteRole(id: string, userId?: string): Promise<any> {
    throw new Error('Administrator and Operator roles cannot be deleted.');
  },

  // Dashboard stats
  async getDashboardStats(): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('get_dashboard_summary');
    if (error) throw error;
    const inventoryCells = await this.getCells();
    const totalCells = inventoryCells.length;
    const reservedCells = inventoryCells.filter(cell => cell.reservedForOrderId || cell.reservedForBatteryId).length;
    const quarantinedCells = inventoryCells.filter(cell => cell.status === 'QUARANTINED').length;
    const availableCells = inventoryCells.filter(cell =>
      !cell.reservedForOrderId && !cell.reservedForBatteryId && cell.status !== 'QUARANTINED',
    ).length;
    const inventorySummary = {
      ...(data?.inventory || {}),
      totalCells,
      availableCells,
      reservedCells,
      usedCells: reservedCells,
      quarantinedCells,
    };
    
    // Add default fallbacks to satisfy the UI contract if the RPC returns partial data
    return {
      inventory: inventorySummary.totalCells > 0 ? inventorySummary : {
        totalCells: 0, availableCells: 0, usedCells: 0, reservedCells: 0,
        inProcessCells: 0, assembledCells: 0, quarantinedCells: 0,
        finishedBatteries: 0, inProcessBatteries: 0
      },
      quality: data?.quality || { firstPassYieldPercent: 100, quarantinedCount: 0 },
      orders: data?.orders || { total: 0, inProcess: 0, completed: 0, planned: 0 },
      kpis: data?.kpis ? {
        ...data.kpis,
        totalCellsInInventory: totalCells,
        availableCells,
        usedCells: reservedCells,
        reservedCells,
        quarantinedCells,
      } : {
        totalCellsInInventory: 0, availableCells: 0, usedCells: 0, reservedCells: 0,
        inProcessCells: 0, assembledCells: 0, quarantinedCells: 0,
        totalBatteriesCompleted: 0, batteriesInProduction: 0, activeOrders: 0,
        firstPassYield: 100, onlineMachines: 0, totalMachines: 0
      },
      recentBatteries: Array.isArray(data?.recentBatteries) ? toAppValue(data.recentBatteries) : [],
      recentOrders: [],
      recentAuditLogs: [],
      machines: [],
      finishedPackTrend: [],
      activeBatchTrend: [],
      batteryBuildTrend: [],
      bmsTelemetry: { total: 0, tested: 0 },
      controllerInventory: data?.inventory ? {
        availableBms: Number(data.inventory.availableBms || 0),
        availableBmu: Number(data.inventory.availableBmu || 0),
        totalBms: Number(data.inventory.totalBms || 0),
        totalBmu: Number(data.inventory.totalBmu || 0),
      } : { availableBms: 0, availableBmu: 0, totalBms: 0, totalBmu: 0 },
      cellBuckets: [],
      quarantineOpenCount: data?.inventory?.quarantinedCells || 0,
    };
  },

  // Reports & Quality Analytics
  async getReportsAnalytics(): Promise<any> {
    const [cells, batteriesResult, modulesResult, bmsResult, cellTestsResult, batteryTestsResult, quarantineResult] = await Promise.all([
      this.getCells(),
      supabase.from('batteries').select('*'),
      supabase.from('modules').select('*'),
      supabase.from('bms_units').select('*'),
      supabase.from('cell_tests').select('*'),
      supabase.from('battery_tests').select('*'),
      supabase.from('quarantine_records').select('*'),
    ]);
    const results = [batteriesResult, modulesResult, bmsResult, cellTestsResult, batteryTestsResult, quarantineResult];
    const failedResult = results.find(result => result.error);
    if (failedResult?.error) throw failedResult.error;

    const batteries = (batteriesResult.data || []) as any[];
    const modules = (modulesResult.data || []) as any[];
    const bmsUnits = (bmsResult.data || []) as any[];
    const cellTests = (cellTestsResult.data || []) as any[];
    const batteryTests = (batteryTestsResult.data || []) as any[];
    const quarantine = (quarantineResult.data || []) as any[];
    const testedCellIds = new Set(cellTests.map(test => test.cellId).filter(Boolean));
    const testedCells = testedCellIds.size || cells.filter(cell => cell.testedAt).length;
    const testedBatteries = batteryTests.length || batteries.filter(battery => battery.stepResults?.FINAL_TESTING?.status).length;
    const totalTestCycles = cellTests.length + batteryTests.length;
    const totalQuarantined = quarantine.length;
    const reservedCells = cells.filter(cell => cell.reservedForOrderId || cell.reservedForBatteryId).length;
    const availableCells = cells.filter(cell => !cell.reservedForOrderId && !cell.reservedForBatteryId && cell.status !== 'QUARANTINED').length;
    const fpy = totalTestCycles > 0
      ? Number(((Math.max(0, totalTestCycles - totalQuarantined) / totalTestCycles) * 100).toFixed(1))
      : 0;
    const weldedModules = modules.filter(module => module.weldingResult?.status);
    const passedWelds = weldedModules.filter(module => module.weldingResult.status === 'PASSED').length;
    const testedBms = bmsUnits.filter(controller => controller.testResult?.status);
    const passedBms = testedBms.filter(controller => controller.testResult.status === 'PASSED').length;
    const buckets: Record<string, number> = { '< 3.297V': 0, '3.298V': 0, '3.300V': 0, '3.302V': 0, '> 3.303V': 0 };
    cells.forEach(cell => {
      const voltage = Number(cell.productionOcvV ?? cell.supplierOcvV ?? 3.300);
      if (voltage < 3.298) buckets['< 3.297V'] += 1;
      else if (voltage < 3.2995) buckets['3.298V'] += 1;
      else if (voltage < 3.3015) buckets['3.300V'] += 1;
      else if (voltage < 3.303) buckets['3.302V'] += 1;
      else buckets['> 3.303V'] += 1;
    });
    const maxCount = Math.max(1, ...Object.values(buckets));
    const ocvDistribution = Object.entries(buckets).map(([label, count]) => ({
      label,
      count,
      height: `${Math.max(8, Math.round((count / maxCount) * 100))}%`,
    }));
    const defectCounts: Record<string, number> = {};
    quarantine.forEach(record => {
      const reason = record.reason || 'General Quality Deviation';
      defectCounts[reason] = (defectCounts[reason] || 0) + 1;
    });
    const totalDefects = Math.max(1, quarantine.length);
    const paretoColors = ['bg-amber-500', 'bg-indigo-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'];
    const pareto = Object.entries(defectCounts)
      .sort(([, firstCount], [, secondCount]) => secondCount - firstCount)
      .map(([mode, count], index) => ({ mode, count, pct: Math.round((count / totalDefects) * 100), color: paretoColors[index % paretoColors.length] }));

    return {
      hasData: cells.length > 0 || batteries.length > 0 || modules.length > 0 || bmsUnits.length > 0 || quarantine.length > 0,
      fpy,
      totalCycles: totalTestCycles,
      laserWeldQuality: weldedModules.length ? Number(((passedWelds / weldedModules.length) * 100).toFixed(1)) : 0,
      bmsTelemetryRate: testedBms.length ? Number(((passedBms / testedBms.length) * 100).toFixed(1)) : 0,
      ocvDistribution,
      pareto,
      totalCells: cells.length,
      reservedCells,
      availableCells,
      totalModules: modules.length,
      totalBatteries: batteries.length,
      weldedModules: weldedModules.length,
      testedCells,
      testedBatteries,
      testedBms: testedBms.length,
      totalBms: bmsUnits.length,
      quarantineOpen: quarantine.filter(record => record.status === 'OPEN').length,
      quarantineResolved: quarantine.filter(record => record.status === 'RESOLVED').length,
    };
  },

  // Products
  async getProducts(): Promise<ProductTemplate[]> {
    const { data, error } = await supabase
      .from('product_templates')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createProduct(product: Partial<ProductTemplate>): Promise<ProductTemplate> {
    const normalizedProtocol = product.bmsProtocol === 'CAN_2.0B' ? 'CAN_2_0B' : product.bmsProtocol;
    const generatedSku = `${product.productModel || product.name || 'PRODUCT'}-${product.batteryName || 'BATTERY'}-${Date.now()}`
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-');
    const { data, error } = await supabase
      .from('product_templates')
      .insert({
        id: `prod-${Date.now()}`,
        sku: product.sku || generatedSku,
        name: product.name || '',
        product_model: product.productModel || product.sku || '',
        battery_name: product.batteryName || product.name || '',
        voltage_type: product.voltageType || 'LV',
        nominalVoltageV: product.nominalVoltageV || 0,
        capacityKwh: product.capacityKwh || 0,
        totalCapacityAh: product.totalCapacityAh || 0,
        numModules: product.numModules || 0,
        cellsPerModule: product.cellsPerModule || 0,
        totalCells: product.totalCells || 0,
        bmsModel: product.bmsModel || 'PACE 51.2V',
        bmsProtocol: normalizedProtocol || 'CAN_2_0B',
        bmsConfig: {
          required: product.bmsConfig?.required || true,
          model: product.bmsConfig?.model || 'PACE 51.2V',
          protocol: product.bmsConfig?.protocol === 'CAN_2.0B' ? 'CAN_2_0B' : (product.bmsConfig?.protocol || 'CAN_2_0B'),
          manufacturer: product.bmsConfig?.manufacturer,
        },
        bmuConfig: product.bmuConfig || { required: false },
        gradingRules: product.gradingRules || {
          minCapacityAh: 90,
          maxCapacityAh: 120,
          minOcvV: 3.2,
          maxOcvV: 3.4,
          maxIrMilliOhm: 1,
          maxDeltaCapacityPercent: 5,
          maxDeltaOcvMv: 5,
          maxDeltaIrMilliOhm: 0.5,
        },
        qcStages: product.qcStages || ['OCV_IR'],
        serialPrefix: product.serialPrefix || 'P2G-BAT',
        active: product.active !== undefined ? product.active : true,
      })
      .select();
    if (error) throw error;
    return data?.[0] || {};
  },

  async deleteProduct(id: string): Promise<any> {
    const { error } = await supabase
      .from('product_templates')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // Suppliers
  async getSuppliers(): Promise<Supplier[]> {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Imports
  async importSupplierCells(data: {
    filename: string;
    rows: any[];
    userId?: string; cellId?: string; grade?: string; remarks?: string;
  }): Promise<{ summary: SupplierImportSummary; importedCount: number }> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const supplierName = data.rows.find(row => row.manufacturer_name)?.manufacturer_name || 'Unknown Supplier';
    const rpcRows = data.rows.map((row: any) => ({
      internal_serial: row.internal_serial || row.barcode || row.supplier_barcode,
      supplier_barcode: row.supplier_barcode || row.barcode || row.internal_serial,
      ocv: row.ocv ?? row.ocv_v,
      ir: row.ir ?? row.ri ?? row.ir_mohm,
      batch_number: row.batch_number || row.group || null,
      pallet_number: row.pallet_number || row.pallet || null,
      box_number: row.box_number || row.box || null,
    }));
    const { data: result, error } = await rawSupabase.rpc('import_supplier_cells_bulk', {
      p_filename: data.filename,
      p_supplier_name: supplierName,
      p_rows: rpcRows,
    });
    if (error) throw error;
    const mapped = toAppValue(result || {}) as any;
    return {
      summary: {
        ...(mapped.summary || {}),
        totalRows: mapped.total || data.rows.length,
        validRows: mapped.imported ?? mapped.importedCount ?? 0,
        importedAt: mapped.summary?.importedAt || new Date().toISOString(),
      },
      importedCount: Number(mapped.importedCount ?? mapped.imported ?? 0),
    };
  },

  async getSupplierImports(): Promise<SupplierImportSummary[]> {
    const { data, error } = await supabase
      .from('supplier_imports')
      .select('*')
      .order('imported_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Inventory
  async getCells(params?: { status?: string; search?: string; limit?: number; usedOnly?: boolean }): Promise<CellItem[]> {
    const pageSize = 1000;
    const requestedLimit = params?.limit && params.limit > 0 ? params.limit : undefined;
    const cells: CellItem[] = [];

    for (let offset = 0; requestedLimit === undefined || cells.length < requestedLimit; offset += pageSize) {
      let query = supabase.from('cells').select('*');

      if (params?.status) {
        query = query.eq('status', params.status);
      }
      if (params?.usedOnly === true) {
        query = query.not('reservedForBatteryId', 'is', null);
      }
      if (params?.search && typeof params.search === 'string') {
        const q = params.search.toLowerCase();
        query = query.or(`internalSerial.ilike.%${q}%,supplierBarcode.ilike.%${q}%,supplierName.ilike.%${q}%,palletNumber.ilike.%${q}%,boxNumber.ilike.%${q}%`);
      }

      const end = requestedLimit === undefined
        ? offset + pageSize - 1
        : Math.min(offset + pageSize - 1, requestedLimit - 1);
      const { data, error } = await query.order('created_at', { ascending: false }).range(offset, end);
      if (error) throw error;
      const page = (data || []) as CellItem[];
      cells.push(...page);
      if (page.length < pageSize) break;
    }

    return requestedLimit === undefined ? cells : cells.slice(0, requestedLimit);
  },

  async getCellInventoryBuckets(): Promise<Array<{ cellId: string; bucket: 'AVAILABLE' | 'RESERVED' | 'IN_PROCESS' | 'DAMAGE'; batteryId?: string; moduleId?: string; reason?: string }>> {
    const { data, error } = await supabase.from('cell_inventory_buckets').select('*');
    if (error) throw error;
    return data || [];
  },

  async getBmsUnits(): Promise<BMSItem[]> {
    const { data, error } = await supabase.from('bms_units').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createBmsBatch(params?: { count?: number; model?: string; supplier?: string; manufacturer?: string; batchNumber?: string; barcodePrefix?: string; serialNumbers?: string[] }): Promise<{ count: number; items: BMSItem[] }> {
    const count = (params?.count ?? 10);
    const model = params?.model || 'PACE-51.2V-100A-CAN';
    const supplier = params?.supplier || params?.manufacturer || 'Power2Go Verified';
    const protocol = 'CAN_2_0B';
    const created: BMSItem[] = [];

    for (let i = 1; i <= count; i++) {
      const nextNum = i;
      const serial = params?.serialNumbers?.[i - 1] || (params?.barcodePrefix ? `${params.barcodePrefix}-${String(nextNum).padStart(5, '0')}` : `P2G-BMS-${Date.now()}-${String(nextNum).padStart(4, '0')}`);
      const id = `bms-${crypto.randomUUID()}`;

      const { data, error } = await supabase.from('bms_units').insert({
        id,
        serialNumber: serial,
        model,
        supplier,
        manufacturer: params?.manufacturer || supplier,
        batchNumber: params?.batchNumber || 'UNSPECIFIED',
        firmwareVersion: 'v4.2.1-prod',
        hardwareVersion: 'HW-Rev3',
        protocol: protocol as any,
        status: 'AVAILABLE' as any,
        createdAt: new Date().toISOString(),
      }).select();
      if (error) throw error;
      created.push(data?.[0] || {});
    }

    return { count, items: created };
  },

  async getBmuUnits(): Promise<BMUItem[]> {
    const { data, error } = await supabase.from('bmu_units').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createBmuBatch(params?: { count?: number; model?: string; manufacturer?: string; batchNumber?: string; barcodePrefix?: string; serialNumbers?: string[] }): Promise<{ count: number; items: BMUItem[] }> {
    const count = params?.count ?? 10;
    const model = params?.model || 'Power2Go BMU-X1';
    const manufacturer = params?.manufacturer || 'Power2Go';
    const created: BMUItem[] = [];

    for (let i = 1; i <= count; i++) {
      const serial = params?.serialNumbers?.[i - 1] || (params?.barcodePrefix ? `${params.barcodePrefix}-${String(i).padStart(5, '0')}` : `P2G-BMU-${Date.now()}-${String(i).padStart(4, '0')}`);
      const id = `bmu-${crypto.randomUUID()}`;
      const { data, error } = await supabase.from('bmu_units').insert({
        id,
        serialNumber: serial,
        model,
        manufacturer,
        batchNumber: params?.batchNumber || 'UNSPECIFIED',
        protocol: 'CAN',
        status: 'AVAILABLE' as any,
        createdAt: new Date().toISOString(),
      }).select();
      if (error) throw error;
      created.push(data?.[0] || {} as BMUItem);
    }

    return { count, items: created };
  },

  async updateBms(id: string, update: { status?: string; model?: string; firmwareVersion?: string; hardwareVersion?: string; protocol?: string }): Promise<BMSItem> {
    const { data, error } = await supabase.from('bms_units').update(update).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteBms(id: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error } = await rawSupabase.rpc('delete_controller_transaction', { p_controller_type: 'BMS', p_controller_id: id });
    if (error) throw error;
  },

  async updateBmu(id: string, update: { status?: string; model?: string; manufacturer?: string; protocol?: string }): Promise<BMUItem> {
    const { data, error } = await supabase.from('bmu_units').update(update).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteBmu(id: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error } = await rawSupabase.rpc('delete_controller_transaction', { p_controller_type: 'BMU', p_controller_id: id });
    if (error) throw error;
  },

  async getModules(): Promise<ModuleItem[]> {
    const { data, error } = await supabase.from('modules').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const modules = (data || []) as any[];
    const moduleIds = modules.map(module => module.id).filter(Boolean);
    if (moduleIds.length === 0) return modules;
    const { data: assignments, error: assignmentsError } = await supabase
      .from('module_cells')
      .select('moduleId, cellId, cellSlotIndex, cell:cells(*)')
      .in('moduleId', moduleIds)
      .order('cellSlotIndex', { ascending: true });
    if (assignmentsError) throw assignmentsError;
    const cellsByModule = new Map<string, any[]>();
    (assignments || []).forEach((assignment: any) => {
      if (!assignment.cell) return;
      const cells = cellsByModule.get(assignment.moduleId) || [];
      cells.push({ ...assignment.cell, moduleSlotIndex: assignment.cellSlotIndex });
      cellsByModule.set(assignment.moduleId, cells);
    });
    return modules.map(module => ({
      ...module,
      qrCode: module.qrCode || `${module.serialNumber}|MODULE:${module.id}`,
      cells: cellsByModule.get(module.id) || [],
    })) as ModuleItem[];
  },

  async updateModule(id: string, update: { status?: string; matchingScore?: number }): Promise<ModuleItem> {
    const { data, error } = await supabase.from('modules').update(update).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteModule(id: string): Promise<void> {
    const { error: releaseError } = await supabase.from('cells').update({
      status: 'AVAILABLE',
      assignedToModuleId: null,
      moduleSlotIndex: null,
      updatedAt: new Date().toISOString(),
    }).eq('assignedToModuleId', id);
    if (releaseError) throw releaseError;
    const { error } = await supabase.from('modules').delete().eq('id', id);
    if (error) throw error;
  },

  async getBatteries(): Promise<BatteryUnit[]> {
    const { data, error } = await supabase
      .from('batteries')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const batteries = (data || []) as any[];
    const batteryIds = batteries.map(battery => battery.id).filter(Boolean);
    if (batteryIds.length === 0) return [];
    const [bmsResult, bmuResult] = await Promise.all([
      supabase.from('bms_units').select('*'),
      supabase.from('bmu_units').select('*'),
    ]);
    if (bmsResult.error) throw bmsResult.error;
    if (bmuResult.error) throw bmuResult.error;
    const bmsById = new Map((bmsResult.data || []).map((controller: any) => [controller.id, controller]));
    const bmuById = new Map((bmuResult.data || []).map((controller: any) => [controller.id, controller]));
    const { data: modules, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .in('batteryId', batteryIds)
      .order('moduleIndex', { ascending: true });
    if (modulesError) throw modulesError;
    const moduleIds = (modules || []).map((module: any) => module.id).filter(Boolean);
    const { data: assignments, error: assignmentsError } = moduleIds.length
      ? await supabase.from('module_cells').select('moduleId, cellId, cellSlotIndex, cell:cells(*)').in('moduleId', moduleIds).order('cellSlotIndex', { ascending: true })
      : { data: [], error: null };
    if (assignmentsError) throw assignmentsError;
    const cellsByModule = new Map<string, any[]>();
    (assignments || []).forEach((assignment: any) => {
      if (!assignment.cell) return;
      const cells = cellsByModule.get(assignment.moduleId) || [];
      cells.push({ ...assignment.cell, moduleSlotIndex: assignment.cellSlotIndex });
      cellsByModule.set(assignment.moduleId, cells);
    });
    const modulesByBattery = new Map<string, any[]>();
    (modules || []).forEach((module: any) => {
      const batteryModules = modulesByBattery.get(module.batteryId) || [];
      batteryModules.push({
        ...module,
        qrCode: module.qrCode || `${module.serialNumber}|MODULE:${module.id}`,
        cells: cellsByModule.get(module.id) || [],
      });
      modulesByBattery.set(module.batteryId, batteryModules);
    });
    return batteries.map(battery => ({
      ...battery,
      qrCode: battery.qrCode || `${battery.serialNumber}|BATTERY:${battery.id}`,
      bms: bmsById.get(battery.bmsId),
      bmu: bmuById.get(battery.bmuId),
      modules: modulesByBattery.get(battery.id) || [],
    })) as BatteryUnit[];
  },

  async updateBattery(id: string, update: { status?: string; currentStep?: string; progressPercent?: number }): Promise<BatteryUnit> {
    const { data, error } = await supabase.from('batteries').update(update).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteBattery(id: string): Promise<void> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error: deletionError } = await rawSupabase.rpc('delete_battery_cascade', { p_battery_id: id });
    if (deletionError) throw deletionError;
    return;

  },

  // Orders
  async getProductionOrders(): Promise<ProductionOrder[]> {
    const { data, error } = await supabase
      .from('production_orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createProductionOrder(data: {
    productId: string;
    quantity: number;
    orderNumber?: string;
    userId?: string; cellId?: string; grade?: string; remarks?: string;
  }): Promise<{ order: ProductionOrder; batteryIds: string[] }> {
    if (!Number.isInteger(data.quantity) || data.quantity < 1) {
      throw new Error('Quantity must be a positive whole number');
    }
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data: transactionResult, error: transactionError } = await rawSupabase.rpc('create_production_order_transaction', {
      p_product_id: data.productId,
      p_quantity: data.quantity,
      p_order_number: data.orderNumber || null,
    });
    if (transactionError) throw transactionError;
    const mappedTransaction = toAppValue(transactionResult || {});
    return {
      order: mappedTransaction.order,
      batteryIds: mappedTransaction.batteryIds || [],
    };

    /*
    const product = await supabase.from('product_templates').select('*').eq('id', data.productId).maybeSingle();
    if (!product?.data) throw new Error('Product template not found');

    const prod = product.data;
    const requiredCells = prod.totalCells * data.quantity;
    const orderId = data.orderNumber || `PO-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Date.now()).padStart(4, '0')}`;

    // Reserve cells from available inventory
    const { data: availableCells, error: cellsError } = await supabase
      .from('cells')
      .select('*')
      .eq('status', 'AVAILABLE')
      .limit(requiredCells);
    if (cellsError) throw cellsError;

    if ((availableCells?.length || 0) < requiredCells) {
      throw new Error('Insufficient cell inventory to start production order');
    }

    const batteryIds: string[] = [];

    const { error: initialOrderError } = await supabase.from('production_orders').insert({
      id: orderId,
      orderNumber: data.orderNumber || orderId,
      productId: prod.id,
      productSku: prod.sku,
      productName: prod.name,
      quantityPlanned: data.quantity,
      quantityCompleted: 0,
      quantityInProcess: data.quantity,
      quantityFailed: 0,
      status: 'IN_PROCESS',
      requiredCells,
      availableCells: availableCells.length,
      reservedCells: 0,
      shortageCells: 0,
      requiredBms: 0,
      availableBms: 0,
      reservedBms: 0,
      shortageBms: 0,
      batteryIds: [],
      createdBy: data.userId || undefined,
    });
    if (initialOrderError) throw initialOrderError;

    for (let q = 0; q < data.quantity; q++) {
      const batId = `bat-${Date.now()}-${q}`;
      const batSerial = `${prod.serialPrefix}-${String(Date.now() + q + 1).padStart(6, '0')}`;
      batteryIds.push(batId);

      // Create modules based on product configuration
      const modules: any[] = [];
      for (let m = 0; m < prod.numModules; m++) {
        const modId = `mod-${Date.now()}-${q}-${m}`;
        const moduleSerial = `${prod.serialPrefix}-MOD-${Date.now()}-${q}-${m + 1}`;
        modules.push({
          id: modId,
          serialNumber: moduleSerial,
          qrCode: `${moduleSerial}|${prod.sku}|BATTERY:${batSerial}`,
          productId: prod.id,
          productionOrderId: orderId,
          batteryId: batId,
          moduleIndex: m,
          cells: [],
          matchingScore: 0,
          matchingMetrics: {
            avgCapacityAh: 0,
            deltaCapacityAh: 0,
            avgOcvV: 0,
            deltaOcvV: 0,
            avgIrMilliOhm: 0,
            deltaIrMilliOhm: 0,
          },
          status: 'IN_PROCESS',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // Create battery record
      const { error: batteryError } = await supabase.from('batteries').insert({
        id: batId,
        serialNumber: batSerial,
        qrCode: `${batSerial}|${prod.sku}|IN_PROCESS`,
        productionOrderId: orderId,
        productId: prod.id,
        productName: prod.name,
        currentStep: 'CELL_IDENTIFICATION',
        progressPercent: 5,
        status: 'IN_PROCESS',
        modules,
        stepResults: {
          CELL_IDENTIFICATION: { stepName: 'Cell Identification & Verification', status: 'READY', mode: 'AUTO' },
          CELL_TESTING: { stepName: 'OCV & IR Testing', status: 'PENDING', mode: 'AUTO' },
          GRADING: { stepName: 'Automatic Cell Grading', status: 'PENDING', mode: 'AUTO' },
          CELL_MATCHING: { stepName: 'Module Cell Matching', status: 'PENDING', mode: 'AUTO' },
          MODULE_ASSEMBLY: { stepName: 'Module Assembly', status: 'PENDING', mode: 'MANUAL' },
          LASER_WELDING: { stepName: 'Laser Busbar Welding', status: 'PENDING', mode: 'AUTO' },
          MODULE_QC: { stepName: 'Module QC Inspection', status: 'PENDING', mode: 'MANUAL' },
          BATTERY_ASSEMBLY: { stepName: 'Battery Enclosure Assembly', status: 'PENDING', mode: 'MANUAL' },
          BMS_INTEGRATION: { stepName: 'BMS Harness & Comms Testing', status: 'PENDING', mode: 'AUTO' },
          FINAL_TESTING: { stepName: 'Pack High-Pot & Dyn Load Test', status: 'PENDING', mode: 'AUTO' },
          FINAL_QC: { stepName: 'Final Quality Release & Label', status: 'PENDING', mode: 'MANUAL' },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (batteryError) throw batteryError;

      const { error: moduleError } = await supabase.from('modules').insert(modules);
      if (moduleError) throw moduleError;

      // Reserve cells after the referenced battery exists.
      const reservedIds = (availableCells || [])
        .slice(q * prod.totalCells, (q + 1) * prod.totalCells)
        .map((c: any) => c.id);
      if (reservedIds.length > 0) {
        const { error: reservationError } = await supabase.from('cells').update({
          status: 'RESERVED',
          reservedForOrderId: orderId,
          reservedForBatteryId: batId,
          updatedAt: new Date().toISOString(),
        }).in('id', reservedIds);
        if (reservationError) throw reservationError;
      }
    }

    const { error: orderError } = await supabase.from('production_orders').update({
      reservedCells: requiredCells,
      batteryIds,
      updatedAt: new Date().toISOString(),
    }).eq('id', orderId);
    if (orderError) throw orderError;

    // Record audit
    await supabase.from('audit_logs').insert({
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      userId: data.userId || 'usr-admin-01',
      userName: 'Administrator',
      userRole: 'admin',
      action: `Created Production Order ${data.orderNumber || `PO-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Date.now()).padStart(4, '0')}`} for ${data.quantity}x ${prod.name} (Reserved ${requiredCells} cells)`,
      entityType: 'ORDER',
      entityId: orderId,
    });

    return {
      order: {
        id: orderId,
        orderNumber: data.orderNumber || `PO-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Date.now()).padStart(4, '0')}`,
        productId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        quantityPlanned: data.quantity,
        quantityCompleted: 0,
        quantityInProcess: data.quantity,
        quantityFailed: 0,
        status: 'IN_PROCESS',
        requiredCells,
        availableCells: availableCells?.length || 0,
        reservedCells: requiredCells,
        shortageCells: 0,
        requiredBms: 0,
        availableBms: 0,
        reservedBms: 0,
        shortageBms: 0,
        batteryIds,
        createdBy: data.userId || 'usr-admin-01',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      batteryIds,
    };
    */
  },

  async cancelProductionOrder(id: string, reason?: string, userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error } = await rawSupabase.rpc('cancel_production_order_transaction', {
      p_order_id: id,
      p_reason: reason || 'Cancelled by operator',
      p_user_id: userId || null,
    });
    if (error) throw error;
    return { success: true };
  },

  // Battery & Visual Builder
  async getBattery(id: string): Promise<{ battery: BatteryUnit; product: ProductTemplate; order: ProductionOrder }> {
    const { data: battery, error: batteryError } = await supabase
      .from('batteries')
      .select('*, product:product_templates(*), order:production_orders(*)')
      .eq('id', id)
      .single();
    if (batteryError) throw batteryError;
    if (!battery?.product) throw new Error('Product data is missing for this battery in Supabase.');
    let bms;
    let bmu;
    if (battery.bmsId) {
      const result = await supabase.from('bms_units').select('*').eq('id', battery.bmsId).maybeSingle();
      if (result.error) throw result.error;
      bms = result.data;
    }
    if (battery.bmuId) {
      const result = await supabase.from('bmu_units').select('*').eq('id', battery.bmuId).maybeSingle();
      if (result.error) throw result.error;
      bmu = result.data;
    }
    const { data: relationalModules, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .eq('batteryId', id)
      .order('moduleIndex', { ascending: true });
    if (modulesError) throw modulesError;
    battery.modules = relationalModules || [];
    const moduleIds = battery.modules.map((module: any) => module.id);
    if (moduleIds.length > 0) {
      const { data: assignments, error: assignmentError } = await supabase
        .from('module_cells')
        .select('moduleId, cellId, cellSlotIndex, cell:cells(*)')
        .in('moduleId', moduleIds)
        .order('cellSlotIndex', { ascending: true });
      if (assignmentError) throw assignmentError;
      const assignmentsByModule = new Map<string, any[]>();
      (assignments || []).forEach((assignment: any) => {
        const cells = assignmentsByModule.get(assignment.moduleId) || [];
        if (assignment.cell) cells.push({ ...assignment.cell, moduleSlotIndex: assignment.cellSlotIndex });
        assignmentsByModule.set(assignment.moduleId, cells);
      });
      battery.modules = battery.modules.map((module: any) => ({
        ...module,
        cells: assignmentsByModule.get(module.id) || module.cells || [],
      }));
    }
    return {
      battery: {
        ...battery,
        modules: Array.isArray(battery.modules) ? battery.modules : [],
        bms,
        bmu,
      },
      product: battery.product,
      order: battery.order,
    } as any;
  },

  async scanComponent(batteryId: string, data: {
    barcode: string;
    slotType: 'CELL' | 'BMS' | 'BMU';
    moduleIndex?: number;
    cellSlotIndex?: number;
    userId?: string; cellId?: string; grade?: string; remarks?: string; manufacturer?: string; batchNumber?: string;
  }): Promise<any> {
    const { data: battery, error: batteryError } = await supabase
      .from('batteries')
      .select('*, product:product_templates(*)')
      .eq('id', batteryId)
      .single();
    if (batteryError) throw batteryError;
    const prod = battery.product;

    if (data.slotType === 'BMS') {
      if (!rawSupabase) throw new Error('Supabase is not configured.');
      const { data: result, error } = await rawSupabase.rpc('assign_controller_transaction', {
        p_battery_id: batteryId,
        p_controller_type: 'BMS',
        p_controller_id: data.barcode,
        p_metadata: { manufacturer: data.manufacturer, batchNumber: data.batchNumber },
      });
      if (error) throw error;
      return toAppValue(result);

      /*
      const { data: existingBms, error: bmsError } = await supabase
        .from('bms_units')
        .select('*')
        .or(`serialNumber.eq.${data.barcode},id.eq.${data.barcode}`)
        .maybeSingle();

      if (bmsError) throw bmsError;

      if (existingBms) {
        const bms = existingBms;
        if (bms.assignedToBatteryId && bms.assignedToBatteryId !== batteryId) {
          throw new Error(`BMS ${bms.serialNumber} is already assembled in Battery ${bms.assignedToBatteryId}`);
        }
        if (bms.status === 'QUARANTINED') {
          throw new Error(`BMS ${bms.serialNumber} is in QUARANTINE: ${bms.quarantineReason || 'Failed test'}`);
        }
        const { error: linkError } = await supabase.from('bms_units').update({
          assignedToBatteryId: batteryId,
          status: 'IN_PROCESS',
          manufacturer: data.manufacturer,
          batchNumber: data.batchNumber,
          updatedAt: new Date().toISOString(),
        }).eq('id', bms.id);
        if (linkError) throw linkError;
        const { error: batteryLinkError } = await supabase.from('batteries').update({
          bmsId: bms.id,
          updatedAt: new Date().toISOString(),
        }).eq('id', batteryId);
        if (batteryLinkError) throw batteryLinkError;
        return { success: true, itemType: 'BMS', item: bms };
      } else {
        const { data: newBms, error: newBmsError } = await supabase.from('bms_units').insert({
          id: `bms-${Date.now()}`,
          serialNumber: data.barcode,
          model: prod?.bmsConfig?.model || 'PACE 51.2V',
          supplier: prod?.bmsConfig?.manufacturer || 'Power2Go Verified',
          firmwareVersion: 'v1.2.0',
          hardwareVersion: 'v2.0',
          protocol: prod?.bmsConfig?.protocol || 'CAN_2_0B',
          status: 'IN_PROCESS',
          assignedToBatteryId: batteryId,
          manufacturer: data.manufacturer || prod?.bmsConfig?.manufacturer || 'Power2Go Verified',
          batchNumber: data.batchNumber,
          createdAt: new Date().toISOString(),
        }).select();
        if (newBmsError) throw newBmsError;
        const { error: batteryLinkError } = await supabase.from('batteries').update({
          bmsId: newBms?.[0]?.id,
          updatedAt: new Date().toISOString(),
        }).eq('id', batteryId);
        if (batteryLinkError) throw batteryLinkError;
        return { success: true, itemType: 'BMS', item: newBms?.[0] };
      }
      */
    }

    if (data.slotType === 'BMU') {
      if (!rawSupabase) throw new Error('Supabase is not configured.');
      const { data: result, error } = await rawSupabase.rpc('assign_controller_transaction', {
        p_battery_id: batteryId,
        p_controller_type: 'BMU',
        p_controller_id: data.barcode,
        p_metadata: { manufacturer: data.manufacturer, batchNumber: data.batchNumber },
      });
      if (error) throw error;
      return toAppValue(result);

      /*
      const { data: existingBmu, error: bmuError } = await supabase
        .from('bmu_units')
        .select('*')
        .or(`serialNumber.eq.${data.barcode},id.eq.${data.barcode}`)
        .maybeSingle();

      if (bmuError) throw bmuError;

      if (existingBmu) {
        const bmu = existingBmu;
        if (bmu.assignedToBatteryId && bmu.assignedToBatteryId !== batteryId) {
          throw new Error(`BMU ${bmu.serialNumber} is already assembled in Battery ${bmu.assignedToBatteryId}`);
        }
        if (bmu.status === 'QUARANTINED') {
          throw new Error(`BMU ${bmu.serialNumber} is in QUARANTINE: ${bmu.quarantineReason || 'Failed test'}`);
        }
        const { error: bmuLinkError } = await supabase.from('bmu_units').update({
          assignedToBatteryId: batteryId,
          status: 'IN_PROCESS',
          manufacturer: data.manufacturer,
          batchNumber: data.batchNumber,
          updatedAt: new Date().toISOString(),
        }).eq('id', bmu.id);
        if (bmuLinkError) throw bmuLinkError;
        const { error: batteryLinkError } = await supabase.from('batteries').update({
          bmuId: bmu.id,
          updatedAt: new Date().toISOString(),
        }).eq('id', batteryId);
        if (batteryLinkError) throw batteryLinkError;
        return { success: true, itemType: 'BMU', item: bmu };
      } else {
        const { data: newBmu, error: newBmuError } = await supabase.from('bmu_units').insert({
          id: `bmu-${Date.now()}`,
          serialNumber: data.barcode,
          model: prod?.bmuConfig?.model || 'Power2Go BMU-X1',
          manufacturer: data.manufacturer || prod?.bmuConfig?.manufacturer || 'Power2Go',
          protocol: prod?.bmuConfig?.protocol || 'CAN',
          status: 'IN_PROCESS',
          assignedToBatteryId: batteryId,
          batchNumber: data.batchNumber,
          createdAt: new Date().toISOString(),
        }).select();
        if (newBmuError) throw newBmuError;
        const { error: batteryLinkError } = await supabase.from('batteries').update({
          bmuId: newBmu?.[0]?.id,
          updatedAt: new Date().toISOString(),
        }).eq('id', batteryId);
        if (batteryLinkError) throw batteryLinkError;
        return { success: true, itemType: 'BMU', item: newBmu?.[0] };
      }
      */
    }

    // CELL Scanning
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data: modules, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .eq('batteryId', batteryId)
      .order('moduleIndex', { ascending: true });
    if (modulesError) throw modulesError;
    const targetModuleIndex = data.moduleIndex || 0;
    const targetModule = (modules || []).find((module: any) => module.moduleIndex === targetModuleIndex);
    if (!targetModule) {
      throw new Error(`Module index ${targetModuleIndex} out of range`);
    }
    const { data: result, error } = await rawSupabase.rpc('assign_cell_transaction', {
      p_battery_id: batteryId,
      p_cell_barcode: data.barcode,
      p_module_index: targetModuleIndex,
      p_cell_slot_index: data.cellSlotIndex,
      p_user_id: data.userId || null,
    });
    if (error) throw error;
    
    // Return updated battery
    return { success: true, itemType: 'CELL', battery: toAppValue(result) };
  },

  async replaceController(batteryId: string, controllerType: 'BMS' | 'BMU', controllerId: string, userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('replace_controller_transaction', {
      p_battery_id: batteryId,
      p_controller_type: controllerType,
      p_controller_id: controllerId,
      p_user_id: userId || null,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async moveCell(batteryId: string, sourceModuleIndex: number, sourceCellSlotIndex: number, targetModuleIndex: number, targetCellSlotIndex: number): Promise<void> {
    const modulesSnapshot = await supabase.from('batteries').select('modules').eq('id', batteryId).single();
    const modules = Array.isArray(modulesSnapshot.data?.modules) ? modulesSnapshot.data.modules : [];
    const source = modules.find((module: any) => module.moduleIndex === sourceModuleIndex);
    const target = modules.find((module: any) => module.moduleIndex === targetModuleIndex);
    const cell = source?.cells?.find((item: any) => item.moduleSlotIndex === sourceCellSlotIndex);
    if (!target || !cell) throw new Error('The selected cell or target module does not exist.');
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { error: moveError } = await rawSupabase.rpc('move_cell_transaction', {
      p_battery_id: batteryId,
      p_cell_id: cell.id,
      p_target_module_id: target.id,
      p_target_slot: targetCellSlotIndex,
    });
    if (moveError) throw moveError;
    return;

    /*
    const { data: battery, error: batteryError } = await supabase
      .from('batteries')
      .select('modules')
      .eq('id', batteryId)
      .single();
    if (batteryError) throw batteryError;

    const modules = Array.isArray(battery.modules) ? battery.modules.map((module: any) => ({
      ...module,
      cells: Array.isArray(module.cells) ? [...module.cells] : [],
    })) : [];
    const sourceModule = modules.find((module: any) => module.moduleIndex === sourceModuleIndex);
    const targetModule = modules.find((module: any) => module.moduleIndex === targetModuleIndex);
    if (!sourceModule || !targetModule) throw new Error('The selected module does not exist.');
    if (sourceModuleIndex === targetModuleIndex && sourceCellSlotIndex === targetCellSlotIndex) {
      throw new Error('Choose a different destination slot.');
    }
    if (targetModule.cells.some((cell: any) => cell.moduleSlotIndex === targetCellSlotIndex)) {
      throw new Error('The destination slot is already occupied.');
    }

    const sourceCellIndex = sourceModule.cells.findIndex((cell: any) => cell.moduleSlotIndex === sourceCellSlotIndex);
    if (sourceCellIndex < 0) throw new Error('The source slot is empty.');
    const [cell] = sourceModule.cells.splice(sourceCellIndex, 1);
    const movedCell = { ...cell, assignedToModuleId: targetModule.id, moduleSlotIndex: targetCellSlotIndex };
    targetModule.cells.push(movedCell);

    const { error: cellError } = await supabase.from('cells').update({
      assignedToModuleId: targetModule.id,
      moduleSlotIndex: targetCellSlotIndex,
      updatedAt: new Date().toISOString(),
    }).eq('id', cell.id);
    if (cellError) throw cellError;

    const { error: normalizedMoveError } = await supabase.from('module_cells').delete()
      .eq('cell_id', cell.id);
    if (normalizedMoveError) throw normalizedMoveError;
    const { error: normalizedMoveInsertError } = await supabase.from('module_cells').insert({
      moduleId: targetModule.id,
      cellId: cell.id,
      cellSlotIndex: targetCellSlotIndex,
    });
    if (normalizedMoveInsertError) throw normalizedMoveInsertError;

    for (const module of [sourceModule, targetModule]) {
      const { error } = await supabase.from('modules').update({ cells: module.cells, updatedAt: new Date().toISOString() }).eq('id', module.id);
      if (error) throw error;
    }

    const { error: batteryUpdateError } = await supabase.from('batteries').update({
      modules,
      updatedAt: new Date().toISOString(),
    }).eq('id', batteryId);
    if (batteryUpdateError) throw batteryUpdateError;
    */
  },

  async autoMatchCells(batteryId: string, userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('auto_match_cells_transaction', {
      p_battery_id: batteryId,
      p_user_id: userId || null,
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /* LEGACY IMPLEMENTATION — REPLACED BY RPC
    const { data: battery, error: batteryError } = await supabase
      .from('batteries')
      .select('*, product:product_templates(*)')
      .eq('id', batteryId)
      .single();
    if (batteryError) throw batteryError;
    const prod = battery.product;

    // Gather candidate cells assigned to this battery
    const { data: candidateCells, error: candidatesError } = await supabase
      .from('cells')
      .select('*')
      .eq('reservedForBatteryId', batteryId)
      .or('status.eq.AVAILABLE,status.eq.RESERVED,status.eq.VALIDATING,status.eq.PASSED')
      .order('supplierCapacityAh', { ascending: false });
    if (candidatesError) throw candidatesError;

    for (let m = 0; m < battery.modules.length; m++) {
      const mod = battery.modules[m];
      const requiredCount = prod?.cellsPerModule || 8;

      // Simple cell matching - sort by capacity and take first N
      const validCells = (candidateCells || []).filter((c: any) =>
        ['AVAILABLE', 'RESERVED', 'VALIDATING', 'PASSED'].includes(c.status)
      );
      const sortedCells = validCells.sort((a: any, b: any) => (b.supplierCapacityAh || 108) - (a.supplierCapacityAh || 108));

      const matched = sortedCells.slice(0, requiredCount);
      if (matched.length < requiredCount) {
        throw new Error(`Could not match ${requiredCount} cells for Module ${m + 1}. Need ${requiredCount} cells.`);
      }

      // Update module cells
      const moduleCellUpdates = matched.map((c: any, idx: number) => ({
        id: c.id,
        moduleSlotIndex: idx,
      }));

      const { error: moduleError } = await supabase.from('modules').update({
        cells: matched.map((c: any) => ({
          ...c,
          moduleSlotIndex: matched.indexOf(c),
          status: 'ASSEMBLED',
          assignedToModuleId: mod.id,
        })),
        matchingScore: 85,
        matchingMetrics: {
          avgCapacityAh: Number((matched.map((c: any) => c.supplierCapacityAh || 108).reduce((a: number, b: number) => a + b, 0) / matched.length).toFixed(4)),
          deltaCapacityAh: Number((Math.max(...matched.map((c: any) => c.supplierCapacityAh || 108)) - Math.min(...matched.map((c: any) => c.supplierCapacityAh || 108))).toFixed(1)),
          avgOcvV: Number((matched.map((c: any) => c.supplierOcvV || 3.30).reduce((a: number, b: number) => a + b, 0) / matched.length).toFixed(4)),
          deltaOcvV: Number((Math.max(...matched.map((c: any) => c.supplierOcvV || 3.30)) - Math.min(...matched.map((c: any) => c.supplierOcvV || 3.30))).toFixed(4)),
          avgIrMilliOhm: Number((matched.map((c: any) => c.supplierIrMilliOhm || 0.25).reduce((a: number, b: number) => a + b, 0) / matched.length).toFixed(4)),
          deltaIrMilliOhm: Number((Math.max(...matched.map((c: any) => c.supplierIrMilliOhm || 0.25)) - Math.min(...matched.map((c: any) => c.supplierIrMilliOhm || 0.25))).toFixed(1)),
        },
        status: 'IN_PROCESS',
        updatedAt: new Date().toISOString(),
      }).eq('id', mod.id);
      if (moduleError) throw moduleError;

      // Update cell assignments
      const { error: cellError } = await supabase.from('cells').update({
        status: 'ASSEMBLED',
        assignedToModuleId: mod.id,
      }).in('id', matched.map((c: any) => c.id));
      if (cellError) throw cellError;

      const { error: assignmentError } = await supabase.from('module_cells').upsert(
        matched.map((c: any, index: number) => ({
          moduleId: mod.id,
          cellId: c.id,
          cellSlotIndex: index,
          assignedBy: userId,
        })),
        { onConflict: 'module_id,cell_slot_index' },
      );
      if (assignmentError) throw assignmentError;
    }

    // Update battery step results
    const avgScore = battery.modules.reduce((s: number, m: any) => s + (m.matchingScore || 0), 0) / battery.modules.length;
    await supabase.from('batteries').update({
      stepResults: {
        CELL_MATCHING: {
          stepName: 'Module Cell Matching',
          status: 'PASSED',
          mode: 'AUTO',
          completedAt: new Date().toISOString(),
          completedBy: userId,
          details: `All ${battery.modules.length} modules matched with average score ${avgScore.toFixed(1)}%`,
        },
        MODULE_ASSEMBLY: {
          stepName: 'Module Assembly',
          status: 'READY',
          mode: 'MANUAL',
        },
      },
      currentStep: 'MODULE_ASSEMBLY',
      progressPercent: 40,
      updatedAt: new Date().toISOString(),
    }).eq('id', batteryId);

    return {
      success: true,
      battery,
      modules: battery.modules,
    };
    */
  },

  async executeStep(batteryId: string, stepKey: string, payload: {
    mode: 'AUTO' | 'MANUAL' | 'BYPASS';
    reuseSupplierData?: boolean;
    manualValues?: any;
    bypassReason?: string;
    userId?: string; cellId?: string; grade?: string; remarks?: string;
  }): Promise<any> {
    const { data: battery, error: batteryError } = await supabase
      .from('batteries')
      .select('*, product:product_templates(*)')
      .eq('id', batteryId)
      .single();
    if (batteryError) throw batteryError;

    const { error: batteryUpdateError } = await supabase.from('batteries').update({
      stepResults: {
        ...(battery.stepResults || {}),
        [stepKey]: {
          stepName: stepKey.replace(/_/g, ' '),
          status: payload.mode === 'AUTO' ? 'PASSED' : payload.mode === 'BYPASS' ? 'BYPASSED' : 'PENDING',
          mode: payload.mode,
          completedAt: new Date().toISOString(),
          completedBy: payload.userId,
          details: payload.remarks || `Step ${stepKey} executed`,
        },
      },
      currentStep: stepKey,
      progressPercent: payload.mode === 'AUTO' ? 50 : 30,
      updatedAt: new Date().toISOString(),
    }).eq('id', batteryId);
    if (batteryUpdateError) throw batteryUpdateError;

    return { success: true, battery };
  },

  async bulkSaveCellOcvIr(batteryId: string, measurements: { cellId: string; productionOcvV: number; productionIrMilliOhm: number }[], userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_cell_tests_bulk', {
      p_battery_id: batteryId,
      p_tests: measurements.map(measurement => ({
        cell_id: measurement.cellId,
        production_ocv_v: measurement.productionOcvV,
        production_ir_mohm: measurement.productionIrMilliOhm,
        id: `ctest-${crypto.randomUUID()}`,
      })),
      p_test_type: 'OCV_IR',
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };
  },

  async bulkSaveCellGrading(batteryId: string, grades: { cellId: string; grade: string; remarks?: string }[], userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_cell_tests_bulk', {
      p_battery_id: batteryId,
      p_tests: grades.map(test => ({
        id: `ctest-${crypto.randomUUID()}`,
        cell_id: test.cellId,
        grade: test.grade,
        remarks: test.remarks,
      })),
      p_test_type: 'GRADING',
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };
  },

  async bulkSaveDamageHistory(batteryId: string, items: { cellId: string; condition: string; remarks?: string; imageUri?: string }[], userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_cell_tests_bulk', {
      p_battery_id: batteryId,
      p_tests: items.map(item => ({
        cell_id: item.cellId,
        condition: item.condition,
        remarks: item.remarks,
        image_uri: item.imageUri,
      })),
      p_test_type: 'DAMAGE',
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };
  },

  async bulkSaveModuleWorkflow(batteryId: string, modules: any[], userId?: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_module_workflow_bulk', {
      p_battery_id: batteryId,
      p_modules: modules.map(module => ({
        module_id: module.moduleId || module.id,
        status: module.status,
        welding_status: module.weldingStatus,
        physical_visual_ok: module.physicalVisualOk,
        voltage_qc_ok: module.voltageQcOk,
        notes: module.notes,
      })),
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /*
    for (const mod of modules) {
      const { error } = await supabase.from('modules').update({
        status: mod.status || 'IN_PROCESS',
        weldingResult: mod.weldingResult || null,
        qcResult: mod.qcResult || null,
        updatedAt: new Date().toISOString(),
      }).eq('id', mod.id).eq('batteryId', batteryId);
      if (error) throw error;
    }
    return { success: true };
    */
  },

  async weldModule(batteryId: string, moduleId: string, payload: {
    mode?: 'AUTO' | 'MANUAL' | 'BYPASS';
    machineId?: string;
    manualParams?: any;
    userId?: string; cellId?: string; grade?: string; remarks?: string;
  }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await (rawSupabase as any).rpc('record_module_workflow_bulk', {
      p_battery_id: batteryId,
      p_modules: [{ moduleId, weldingStatus: payload.mode === 'BYPASS' ? 'BYPASSED' : 'PASSED', physicalVisualOk: true, voltageQcOk: true, ...payload.manualParams, notes: payload.remarks }],
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data), weldResult: toAppValue(data) };

    /*
    const weldResult = {
      status: payload.mode || 'PASSED',
      machineId: payload.machineId || 'MANUAL_OVERRIDE',
      laserPowerWatts: payload.manualParams?.laserPowerWatts || 2800,
      weldTimeMs: payload.manualParams?.weldTimeMs || 4200,
      pullForceKg: payload.manualParams?.pullForceKg || 18.2,
      weldedAt: new Date().toISOString(),
      operatorId: payload.userId,
    };

    const { error } = await supabase.from('modules').update({
      weldingResult: weldResult,
      updatedAt: new Date().toISOString(),
    }).eq('id', moduleId);
    if (error) throw error;

    return { success: true, weldResult };
    */
  },

  async qcModule(batteryId: string, moduleId: string, payload: any): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await (rawSupabase as any).rpc('record_module_workflow_bulk', {
      p_battery_id: batteryId,
      p_modules: [{ moduleId, weldingStatus: 'PASSED', physicalVisualOk: payload.physicalVisualOk ?? true, voltageQcOk: payload.voltageQcOk ?? payload.status === 'PASSED', notes: payload.notes }],
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /*
    const { error } = await supabase.from('modules').update({
      qcResult: payload,
      updatedAt: new Date().toISOString(),
    }).eq('id', moduleId);
    if (error) throw error;
    return { success: true };
    */
  },

  async testBms(batteryId: string, payload: { mode?: 'AUTO' | 'MANUAL'; machineId?: string; userId?: string }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_controller_test_transaction', {
      p_battery_id: batteryId,
      p_controller_type: 'BMS',
      p_result: { status: 'PASSED', mode: payload.mode || 'MANUAL', machineId: payload.machineId },
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /*
    const { error } = await supabase.from('batteries').update({
      stepResults: {
        ...(payload.mode === 'AUTO' ? { BMS_INTEGRATION: { stepName: 'BMS Harness & Comms Testing', status: 'PASSED', mode: 'AUTO' } } : {}),
      },
      updatedAt: new Date().toISOString(),
    }).eq('id', batteryId);
    if (error) throw error;
    return { success: true };
    */
  },

  async finalTest(batteryId: string, payload: { mode?: 'AUTO' | 'MANUAL'; machineId?: string; userId?: string; cellId?: string; grade?: string; remarks?: string; manualValues?: any }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('record_battery_test_transaction', {
      p_battery_id: batteryId,
      p_result: {
        ...(payload.manualValues || {}),
        mode: payload.mode || 'MANUAL',
        machineId: payload.machineId,
        remarks: payload.remarks,
      },
    });
    if (error) throw error;
    return { success: true, battery: toAppValue(data) };

    /*
    const { data: current, error: loadError } = await supabase.from('batteries').select('*').eq('id', batteryId).single();
    if (loadError) throw loadError;
    const qcStatus = payload.manualValues?.qcTesting === 'FAILED' ? 'FAILED' : 'PASSED';
    const update: any = {
      stepResults: {
        ...(current.stepResults || {}),
        FINAL_TESTING: {
          stepName: 'Pack High-Pot & Dyn Load Test',
          status: qcStatus,
          mode: payload.mode || 'MANUAL',
          completedAt: new Date().toISOString(),
          completedBy: payload.userId,
          details: payload.remarks || 'Final pack test executed',
          values: payload.manualValues || {},
        },
        FINAL_QC: {
          ...(current.stepResults?.FINAL_QC || {}),
          stepName: 'Final Quality Release & Label',
          status: 'READY',
          mode: 'MANUAL',
        },
      },
      currentStep: 'FINAL_QC',
      progressPercent: 95,
      finalQcResult: {
        ...(current.finalQcResult || {}),
        status: qcStatus,
        packVoltageV: Number(payload.manualValues?.packVoltageV ?? current.finalQcResult?.packVoltageV ?? 51.2),
        internalResistanceMilliOhm: Number(payload.manualValues?.batteryIrMohm ?? current.finalQcResult?.internalResistanceMilliOhm ?? 0),
        hiPotInsulationMOhm: Number(payload.manualValues?.hiPotInsulationMOhm ?? current.finalQcResult?.hiPotInsulationMOhm ?? 0),
        bmsTelemetryOk: payload.manualValues?.bmsTelemetryOk ?? true,
        enclosureVisualOk: payload.manualValues?.enclosureVisualOk ?? true,
        testedBy: payload.userId,
        testedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };

    if (payload.cellId) {
      update.stepResults.FINAL_TESTING.manualValues = { cellId: payload.cellId, ...payload.manualValues };
    }

    const { data, error } = await supabase.from('batteries').update(update).eq('id', batteryId).select().single();
    if (error) throw error;
    return { success: true, battery: data };
    */
  },

  async finalQc(batteryId: string, payload: { status: 'PASSED' | 'FAILED'; userId?: string }): Promise<any> {
    if (payload.status === 'FAILED') {
      if (!rawSupabase) throw new Error('Supabase is not configured.');
      const { data, error } = await rawSupabase.rpc('quarantine_item_transaction', {
        p_entity_type: 'BATTERY',
        p_entity_id: batteryId,
        p_reason: 'Failed Final QC sign-off',
      });
      if (error) throw error;
      return { success: true, record: toAppValue(data) };
    }
    const { data: current, error: loadError } = await supabase.from('batteries').select('*, product:product_templates(*), productionOrder:production_orders(*)').eq('id', batteryId).single();
    if (loadError) throw loadError;
    const { data: batteryModules, error: modulesError } = await supabase
      .from('modules')
      .select('*')
      .eq('batteryId', batteryId)
      .order('moduleIndex', { ascending: true });
    if (modulesError) throw modulesError;
    const moduleIds = (batteryModules || []).map((module: any) => module.id).filter(Boolean);
    const { data: moduleCells, error: moduleCellsError } = moduleIds.length
      ? await supabase.from('module_cells').select('moduleId, cellId, cellSlotIndex').in('moduleId', moduleIds)
      : { data: [], error: null };
    if (moduleCellsError) throw moduleCellsError;
    const cellsByModule = new Map<string, any[]>();
    (moduleCells || []).forEach((assignment: any) => {
      const cells = cellsByModule.get(assignment.moduleId) || [];
      cells.push(assignment);
      cellsByModule.set(assignment.moduleId, cells);
    });
    current.modules = (batteryModules || []).map((module: any) => ({
      ...module,
      cells: cellsByModule.get(module.id) || [],
    }));
    const passed = payload.status === 'PASSED';
    if (passed && current.status === 'FINISHED') throw new Error('Battery has already been released.');
    if (passed) {
      const modules = Array.isArray(current.modules) ? current.modules : [];
      const requiredCells = Number(current.product?.totalCells || 0);
      const assignedCells = modules.reduce((total: number, module: any) => total + (Array.isArray(module.cells) ? module.cells.length : 0), 0);
      const cellsComplete = modules.length > 0 && assignedCells > 0 && (!requiredCells || assignedCells >= requiredCells);
      if (!cellsComplete) throw new Error('Cannot release battery: all module cell slots must be assigned.');
      if (!current.bmsId && !current.bmuId) throw new Error('Cannot release battery: assign a BMS or BMU first.');
      if (current.stepResults?.FINAL_TESTING?.status !== 'PASSED') throw new Error('Cannot release battery: pack testing must pass first.');
      if (modules.some((module: any) => module.qcResult?.status && module.qcResult.status !== 'PASSED')) {
        throw new Error('Cannot release battery: every module QC result must pass.');
      }
      const { data: openQuarantine, error: quarantineError } = await supabase
        .from('quarantine_records')
        .select('id, entityId')
        .eq('status', 'OPEN');
      if (quarantineError) throw quarantineError;
      const quarantinedEntityIds = new Set([batteryId, ...modules.map((module: any) => module.id)]);
      if ((openQuarantine || []).some((record: any) => quarantinedEntityIds.has(record.entityId))) {
        throw new Error('Cannot release battery: an open quarantine record exists.');
      }
    }
    if (passed) {
      if (!rawSupabase) throw new Error('Supabase is not configured.');
      const { data, error } = await rawSupabase.rpc('release_battery_transaction', { p_battery_id: batteryId });
      if (error) throw error;
      return { success: true, battery: toAppValue(data) };
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('batteries').update({
      status: passed ? 'FINISHED' : 'QUARANTINED',
      currentStep: passed ? 'COMPLETED' : 'FINAL_QC',
      progressPercent: passed ? 100 : 95,
      qrCode: passed ? `${current.serialNumber}|${current.productName}|PASSED|${now.slice(0, 10)}` : current.qrCode,
      stepResults: {
        ...(current.stepResults || {}),
        FINAL_QC: {
          stepName: 'Final Quality Release & Label',
          status: passed ? 'PASSED' : 'FAILED',
          mode: 'MANUAL',
          completedAt: now,
          completedBy: payload.userId,
          details: passed ? 'Certified for customer dispatch and finished goods inventory' : 'Failed final QC sign-off',
        },
      },
      finalQcResult: {
        ...(current.finalQcResult || {}),
        status: passed ? 'PASSED' : 'FAILED',
        testedBy: payload.userId,
        testedAt: now,
      },
      updatedAt: now,
    }).eq('id', batteryId);
    if (error) throw error;

    if (passed && current.productionOrderId && current.productionOrder) {
      const order = current.productionOrder;
      const completed = Number(order.quantityCompleted || 0) + 1;
      const { error: orderError } = await supabase.from('production_orders').update({
        quantityCompleted: completed,
        quantityInProcess: Math.max(0, Number(order.quantityInProcess || 0) - 1),
        status: completed >= Number(order.quantityPlanned || 0) ? 'COMPLETED' : 'IN_PROCESS',
        updatedAt: now,
      }).eq('id', current.productionOrderId);
      if (orderError) throw orderError;
    }
    return { success: true, battery: data };
  },

  // Universal Traceability Engine
  async universalTrace(query: string): Promise<any> {
    const cleanQuery = query.trim().toLowerCase();
    const find = async (table: string, columns: string[]) => {
      for (const column of columns) {
        const result = await supabase.from(table).select('*').ilike(column, cleanQuery).maybeSingle();
        if (result.error) throw result.error;
        if (result.data) return result.data;
      }
      return null;
    };

    const loadModuleCells = async (moduleId: string) => {
      const { data, error } = await supabase
        .from('module_cells')
        .select('moduleId, cellId, cellSlotIndex, cell:cells(*)')
        .eq('moduleId', moduleId)
        .order('cellSlotIndex', { ascending: true });
      if (error) throw error;
      return (data || []).map((assignment: any) => assignment.cell || assignment);
    };

    const loadBatteryModules = async (batteryId: string) => {
      const { data: modules, error: modulesError } = await supabase
        .from('modules')
        .select('*')
        .eq('batteryId', batteryId)
        .order('moduleIndex', { ascending: true });
      if (modulesError) throw modulesError;
      return Promise.all((modules || []).map(async (module: any) => ({
        ...module,
        cells: await loadModuleCells(module.id),
      })));
    };

    const loadBatteryContext = async (battery: any, context: any) => {
      context.battery = battery;
      context.modules = await loadBatteryModules(battery.id);
      context.cells = context.modules.flatMap((module: any) => module.cells || []);
      if (battery.bmsId) context.bms = (await supabase.from('bms_units').select('*').eq('id', battery.bmsId).maybeSingle()).data;
      if (battery.bmuId) context.bmu = (await supabase.from('bmu_units').select('*').eq('id', battery.bmuId).maybeSingle()).data;
    };

    const buildContext = async (entityType: string, entity: any) => {
      const context: any = { entityType, entity, identifier: query.trim(), status: entity.status };
      const { data: genealogy, error: genealogyError } = await supabase
        .from('genealogy_records')
        .select('*')
        .or(`entityId.eq.${entity.id},parentEntityId.eq.${entity.id}`)
        .limit(500);
      if (!genealogyError) context.genealogy = genealogy || [];
      if (entityType === 'CELL') {
        const supplier = entity.supplierId ? await supabase.from('suppliers').select('*').eq('id', entity.supplierId).maybeSingle() : null;
        if (supplier?.data) context.supplier = supplier.data;
        const { data: assignment, error: assignmentError } = await supabase
          .from('module_cells')
          .select('moduleId')
          .eq('cellId', entity.id)
          .maybeSingle();
        if (assignmentError) throw assignmentError;
        if (assignment?.moduleId) {
          const module = await supabase.from('modules').select('*').eq('id', assignment.moduleId).maybeSingle();
          if (module?.data) context.module = { ...module.data, cells: await loadModuleCells(module.data.id) };
        }
      }
      if (entityType === 'CELL' || entityType === 'MODULE') {
        const batteryId = entityType === 'CELL' ? context.module?.batteryId : entity.batteryId;
        if (batteryId) {
          const battery = await supabase.from('batteries').select('*').eq('id', batteryId).maybeSingle();
          if (battery?.data) await loadBatteryContext(battery.data, context);
        }
      }
      if (entityType === 'BATTERY') {
        await loadBatteryContext(entity, context);
      }
      if (entityType === 'BMS' || entityType === 'BMU') {
        const batteryColumn = entityType === 'BMS' ? 'bmsId' : 'bmuId';
        const battery = await supabase.from('batteries').select('*').eq(batteryColumn, entity.id).maybeSingle();
        if (battery?.data) {
          await loadBatteryContext(battery.data, context);
          context.bms = entityType === 'BMS' ? entity : (await supabase.from('bms_units').select('*').eq('id', battery.data.bmsId).maybeSingle()).data;
          context.bmu = entityType === 'BMU' ? entity : (await supabase.from('bmu_units').select('*').eq('id', battery.data.bmuId).maybeSingle()).data;
        }
      }
      return context;
    };

    const qrMatch = await find('qr_registry', ['qrCode']);
    if (qrMatch) {
      const tableByType: Record<string, string> = {
        CELL: 'cells',
        MODULE: 'modules',
        BATTERY: 'batteries',
        BMS: 'bms_units',
        BMU: 'bmu_units',
      };
      const table = tableByType[qrMatch.entityType];
      if (table) {
        const registeredEntity = await supabase.from(table).select('*').eq('id', qrMatch.entityId).maybeSingle();
        if (registeredEntity.data) return buildContext(qrMatch.entityType, registeredEntity.data);
      }
    }

    const cell = await find('cells', ['supplierBarcode', 'internalSerial', 'id']);
    if (cell) return buildContext('CELL', cell);
    const module = await find('modules', ['serialNumber', 'id']);
    if (module) return buildContext('MODULE', module);
    const battery = await find('batteries', ['serialNumber', 'id']);
    if (battery) return buildContext('BATTERY', battery);
    const bms = await find('bms_units', ['serialNumber', 'id']);
    if (bms) return buildContext('BMS', bms);
    const bmu = await find('bmu_units', ['serialNumber', 'id']);
    if (bmu) return buildContext('BMU', bmu);
    const supplier = await find('suppliers', ['code', 'name', 'id']);
    if (supplier) return buildContext('SUPPLIER', supplier);
    const { data: batchCells, error: batchError } = await supabase
      .from('cells')
      .select('*')
      .or(`batchNumber.eq.${query.trim()},palletNumber.eq.${query.trim()},boxNumber.eq.${query.trim()}`)
      .limit(1000);
    if (!batchError && batchCells?.length) {
      const supplierResult = await supabase.from('suppliers').select('*').eq('id', batchCells[0].supplierId).maybeSingle();
      return {
        entityType: 'SUPPLIER_BATCH',
        identifier: query.trim(),
        entity: { batchIdentifier: query.trim(), cellCount: batchCells.length, supplierName: batchCells[0].supplierName },
        supplier: supplierResult.data,
        cells: batchCells,
      };
    }
    throw new Error('Traceability record not found');
  },

  // Quarantine
  async getQuarantines(): Promise<QuarantineRecord[]> {
    const { data, error } = await supabase
      .from('quarantine_records')
      .select('*')
      .order('quarantined_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getQuarantineRecords(): Promise<QuarantineRecord[]> {
    const { data, error } = await supabase
      .from('quarantine_records')
      .select('*')
      .order('quarantined_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async quarantineItem(payload: { itemType: string; itemId: string; reason: string; userId?: string }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('quarantine_item_transaction', {
      p_entity_type: payload.itemType,
      p_entity_id: payload.itemId,
      p_reason: payload.reason,
    });
    if (error) throw error;
    return { success: true, record: toAppValue(data) };

    /*
    const entityTable = payload.itemType === 'CELL' ? 'cells'
      : payload.itemType === 'MODULE' ? 'modules'
        : payload.itemType === 'BATTERY' ? 'batteries'
          : payload.itemType === 'BMS' ? 'bms_units' : 'bmu_units';
    const { data: entity, error: entityError } = await supabase
      .from(entityTable)
      .select('id,serialNumber')
      .eq('id', payload.itemId)
      .maybeSingle();
    if (entityError) throw entityError;
    if (!entity) throw new Error(`${payload.itemType} not found.`);

    const { data: quarantineRecord, error } = await supabase.from('quarantine_records').insert({
      id: `quar-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      entityType: payload.itemType,
      entityId: payload.itemId,
      entitySerial: entity.serialNumber || payload.itemId,
      reason: payload.reason,
      stage: 'OPEN',
      disposition: 'RELEASE_APPROVED',
      dispositionNotes: 'Resolved by quality',
      quarantinedBy: payload.userId || 'usr-admin-01',
      quarantinedAt: new Date().toISOString(),
      status: 'OPEN',
    }).select('id');
    if (error) throw error;

    // Update item status
    const { error: statusError } = await supabase.from(entityTable).update({ status: 'QUARANTINED' }).eq('id', payload.itemId);
    if (statusError) {
      if (quarantineRecord?.[0]?.id) {
        await supabase.from('quarantine_records').delete().eq('id', quarantineRecord[0].id);
      }
      throw statusError;
    }

    return { success: true };
    */
  },

  async resolveQuarantine(id: string, payload: { action?: string; disposition?: string; notes?: string; dispositionNotes?: string; userId?: string }): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('resolve_quarantine_transaction', {
      p_quarantine_id: id,
      p_disposition: payload.disposition || payload.action || 'RELEASE_APPROVED',
      p_notes: payload.dispositionNotes || payload.notes || 'Resolved by quality',
    });
    if (error) throw error;
    return { success: true, record: toAppValue(data) };

    /*
    const disposition = payload.disposition || payload.action || 'RELEASE_APPROVED';
    const dispositionNotes = payload.dispositionNotes || payload.notes || 'Resolved by quality';

    const { data: record, error: loadError } = await supabase.from('quarantine_records').select('entityType, entityId').eq('id', id).maybeSingle();
    if (loadError) throw loadError;
    if (!record) throw new Error('Quarantine record not found.');

    const { error } = await supabase.from('quarantine_records').update({
      stage: 'RESOLVED',
      disposition,
      dispositionNotes,
      resolvedBy: payload.userId,
      resolvedAt: new Date().toISOString(),
      status: 'RESOLVED',
    }).eq('id', id);
    if (error) throw error;

    // Update item status back to active
    if (record.entityType === 'CELL') {
      const { error: updateError } = await supabase.from('cells').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'AVAILABLE' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    } else if (record.entityType === 'MODULE') {
      const { error: updateError } = await supabase.from('modules').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'AVAILABLE' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    } else if (record.entityType === 'BATTERY') {
      const { error: updateError } = await supabase.from('batteries').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'IN_PROCESS' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    } else if (record.entityType === 'BMS') {
      const { error: updateError } = await supabase.from('bms_units').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'AVAILABLE' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    } else if (record.entityType === 'BMU') {
      const { error: updateError } = await supabase.from('bmu_units').update({ status: disposition === 'SCRAP' ? 'QUARANTINED' : 'ONLINE' }).eq('id', record.entityId);
      if (updateError) throw updateError;
    }

    return { success: true };
    */
  },

  async getWarehouseMovements(entityId?: string): Promise<any[]> {
    let query = supabase.from('warehouse_movements').select('*').order('moved_at', { ascending: false });
    if (entityId) query = query.eq('entityId', entityId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async dispatchBattery(batteryId: string, dispatchReference: string, destination: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('dispatch_battery_transaction', {
      p_battery_id: batteryId,
      p_reference: dispatchReference,
      p_destination: destination,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  async receiveBattery(batteryId: string, location: string): Promise<any> {
    if (!rawSupabase) throw new Error('Supabase is not configured.');
    const { data, error } = await rawSupabase.rpc('receive_battery_transaction', {
      p_battery_id: batteryId,
      p_location: location,
    });
    if (error) throw error;
    return toAppValue(data);
  },

  // Machines
  async getMachines(): Promise<MachineStation[]> {
    const { data, error } = await supabase.from('machine_configurations').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async updateMachine(id: string, payload: { status?: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'BUSY' }): Promise<MachineStation> {
    const { data, error } = await supabase.from('machine_configurations').update(payload).eq('id', id).select();
    if (error) throw error;
    return data?.[0] || {};
  },

  async toggleMachineStatus(id: string, status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE'): Promise<MachineStation> {
    const { data, error } = await supabase.from('machine_configurations').update({ status }).eq('id', id).select();
    if (error) throw error;
    return data?.[0] || {};
  },

  // Audit
  async getAuditLogs(params?: { entityType?: string; search?: string; limit?: number }): Promise<AuditLog[]> {
    let query = supabase.from('audit_logs').select('*');

    if (params?.entityType) {
      query = query.eq('entityType', params.entityType);
    }
    if (params?.search && typeof params.search === 'string') {
      const q = params.search;
      query = query.or(`userName.ilike.%${q}%,action.ilike.%${q}%,entityId.ilike.%${q}%`);
    }
    if (params?.limit) {
      query = query.limit(params.limit);
    }
    const { data, error } = await query.order('timestamp', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Authentication - these now delegate to Supabase Auth
  async login(identifier: string, password: string): Promise<{
    message?: string;
    error?: string;
    pendingToken?: string;
    sessionId?: string;
    user?: any;
  }> {
    // Auth is now handled by Supabase Auth in AuthContext
    // This function is kept for backwards compatibility
    return { message: 'Use login form - authentication via Supabase' };
  },

  async verifyOtp(token: string, otp: string): Promise<{
    message?: string;
    error?: string;
    sessionId?: string;
    user?: any;
  }> {
    // OTP verification is now handled by Supabase Auth in AuthContext
    return { message: 'Use OTP verification via Supabase' };
  },

  async resendOtp(token: string): Promise<{ message?: string; error?: string; resendInSec?: number }> {
    // OTP resend is now handled by Supabase Auth in AuthContext
    return { message: 'Use OTP resend via Supabase dashboard' };
  },

  async getMe(): Promise<any> {
    // Get current user from Supabase auth
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return session.user;
  },

  async logout(): Promise<{ message: string }> {
    // Auth is now handled by Supabase Auth in AuthContext
    await supabase.auth.signOut();
    return { message: 'Logged out successfully' };
  },
};