import fs from 'fs';
import path from 'path';
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
} from '../src/types';
import { hashPassword, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME } from './auth.ts';
import { getServiceClient, isSupabaseConfigured } from './supabase.ts';

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

function isProduction() {
  return process.env.NODE_ENV === 'production' || isVercelRuntime();
}

function localFileAllowed() {
  return false;
}

function dbFilePath() {
  return path.join(process.cwd(), 'memory', 'mes-database.json');
}

type Snapshot = {
  users: User[];
  roles: Role[];
  products: ProductTemplate[];
  suppliers: Supplier[];
  cells: [string, CellItem][];
  bmsUnits: [string, BMSItem][];
  bmuUnits: [string, BMUItem][];
  modules: [string, ModuleItem][];
  batteries: [string, BatteryUnit][];
  orders: [string, ProductionOrder][];
  machines: [string, MachineStation][];
  auditLogs: AuditLog[];
  quarantineRecords: QuarantineRecord[];
  imports: SupplierImportSummary[];
};

class Database {
  users: User[] = [];
  roles: Role[] = [];
  products: ProductTemplate[] = [];
  suppliers: Supplier[] = [];
  cells: Map<string, CellItem> = new Map();
  bmsUnits: Map<string, BMSItem> = new Map();
  bmuUnits: Map<string, BMUItem> = new Map();
  modules: Map<string, ModuleItem> = new Map();
  batteries: Map<string, BatteryUnit> = new Map();
  orders: Map<string, ProductionOrder> = new Map();
  machines: Map<string, MachineStation> = new Map();
  auditLogs: AuditLog[] = [];
  quarantineRecords: QuarantineRecord[] = [];
  imports: SupplierImportSummary[] = [];

  private version = 1;
  private readyPromise: Promise<void>;
  private persistPromise: Promise<void> = Promise.resolve();

  constructor() {
    this.readyPromise = this.hydrate();
  }

  async ready() {
    await this.readyPromise;
  }

  private snapshot(includeSecrets: boolean): Snapshot {
    const users = includeSecrets
      ? this.users
      : this.users.map(({ passwordHash, otpHash, ...safe }) => safe as User);
    return {
      users,
      roles: this.roles,
      products: this.products,
      suppliers: this.suppliers,
      cells: Array.from(this.cells.entries()),
      bmsUnits: Array.from(this.bmsUnits.entries()),
      bmuUnits: Array.from(this.bmuUnits.entries()),
      modules: Array.from(this.modules.entries()),
      batteries: Array.from(this.batteries.entries()),
      orders: Array.from(this.orders.entries()),
      machines: Array.from(this.machines.entries()),
      auditLogs: this.auditLogs,
      quarantineRecords: this.quarantineRecords,
      imports: this.imports,
    };
  }

  private applySnapshot(state: Partial<Snapshot>) {
    this.users = state.users || [];
    this.roles = state.roles || [];
    this.products = state.products || [];
    this.suppliers = state.suppliers || [];
    this.cells = new Map(state.cells || []);
    this.bmsUnits = new Map(state.bmsUnits || []);
    this.bmuUnits = new Map(state.bmuUnits || []);
    this.modules = new Map(state.modules || []);
    this.batteries = new Map(state.batteries || []);
    this.orders = new Map(state.orders || []);
    this.machines = new Map(state.machines || []);
    this.auditLogs = state.auditLogs || [];
    this.quarantineRecords = state.quarantineRecords || [];
    this.imports = state.imports || [];
  }

  private snapshotHasFactoryData(state: Partial<Snapshot> | null | undefined) {
    if (!state) return false;
    return Boolean(
      (state.roles && state.roles.length) ||
        (state.users && state.users.length) ||
        (state.cells && state.cells.length) ||
        (state.products && state.products.length)
    );
  }

  private async hydrate() {
    // Normalized Supabase tables are the only durable source of MES data.
    // This cache exists only for legacy server routes that are being retired.
    this.seedConfigurationOnly();
  }

  public commit() {
    this.persistPromise = this.persistNow();
  }

  public async flush() {
    await this.persistPromise;
  }

  private async persistNow() {
    // Deliberately no-op: durable writes belong to normalized Supabase tables.
  }

  private seedConfigurationOnly() {
    const now = new Date().toISOString();
    this.roles = [
      {
        id: 'role-admin',
        name: 'Administrator',
        description: 'Full system access and security administration',
        status: 'ACTIVE',
        permissions: ['ALL'],
        createdAt: now,
        updatedAt: now,
      },
      ...[
        ['role-operator', 'Operator'],
      ].map(([id, name]) => ({
        id,
        name,
        description: `${name} access`,
        status: 'ACTIVE' as const,
        permissions: [],
        createdAt: now,
        updatedAt: now,
      })),
    ];

    const bootstrap =
      process.env.ADMIN_BOOTSTRAP_PASSWORD || (isProduction() ? '' : DEFAULT_ADMIN_PASSWORD);
    this.users = bootstrap
      ? [
          {
            id: 'usr-admin-01',
            name: 'Administrator',
            username: DEFAULT_ADMIN_USERNAME,
            email: DEFAULT_ADMIN_EMAIL,
            roleId: 'role-admin',
            role: 'admin',
            badgeId: 'P2G-ADMIN-001',
            status: 'ACTIVE',
            passwordHash: hashPassword(bootstrap),
            mustChangePassword: false,
            loginAttempts: 0,
            otpAttempts: 0,
          },
        ]
      : [];

    this.products = [];
    this.suppliers = [
      { id: 'sup-eve', code: 'EVE', name: 'EVE Energy Co., Ltd.', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 108.0, ratingScore: 98 },
      { id: 'sup-catl', code: 'CATL', name: 'Contemporary Amperex Technology (CATL)', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 110.0, ratingScore: 99 },
      { id: 'sup-gotion', code: 'GOTION', name: 'Gotion High-Tech Inc.', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 105.0, ratingScore: 95 },
    ];
    this.cells = new Map();
    this.bmsUnits = new Map();
    this.bmuUnits = new Map();
    this.modules = new Map();
    this.batteries = new Map();
    this.orders = new Map();
    this.auditLogs = [];
    this.quarantineRecords = [];
    this.imports = [];
    this.seedMachines();
  }

  private seedMachines() {
    const ping = new Date().toISOString();
    this.machines.set('MC-OCV-01', {
      id: 'MC-OCV-01',
      name: 'Hioki BT3562 Auto OCV/IR Station',
      type: 'OCV_IR_TESTER',
      status: 'ONLINE',
      ipAddress: '192.168.10.45',
      lastPing: ping,
      totalRuns: 0,
      successRate: 100.0,
      model: 'HIOKI-BT3562-PRO',
    });
    this.machines.set('MC-WELD-01', {
      id: 'MC-WELD-01',
      name: 'Trumpf TruDisk 3kW Laser Welder #1',
      type: 'LASER_WELDER',
      status: 'ONLINE',
      ipAddress: '192.168.10.50',
      lastPing: ping,
      totalRuns: 0,
      successRate: 100.0,
      model: 'TRUMPF-TRUDISK-3000',
    });
    this.machines.set('MC-BMS-01', {
      id: 'MC-BMS-01',
      name: 'Kvaser CAN-Tester & Calibration Rig',
      type: 'BMS_TESTER',
      status: 'ONLINE',
      ipAddress: '192.168.10.62',
      lastPing: ping,
      totalRuns: 0,
      successRate: 100.0,
      model: 'KVASER-LEAF-CAN-CAL',
    });
    this.machines.set('MC-DYN-01', {
      id: 'MC-DYN-01',
      name: 'Chroma 17020 Final Pack Dyn Load 100A',
      type: 'FINAL_DYN_TESTER',
      status: 'ONLINE',
      ipAddress: '192.168.10.80',
      lastPing: ping,
      totalRuns: 0,
      successRate: 100.0,
      model: 'CHROMA-17020E-500V',
    });
  }

  private ensureConfigSeeded(): boolean {
    let dirty = false;
    const roleDefaults = [['role-operator', 'Operator']];
    if (this.roles.length === 0) {
      this.seedConfigurationOnly();
      return true;
    }
    for (const [id, name] of roleDefaults) {
      if (!this.roles.some(role => role.id === id)) {
        this.roles.push({ id, name, description: `${name} access`, status: 'ACTIVE', permissions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        dirty = true;
      }
    }
    if (this.machines.size === 0) {
      this.seedMachines();
      dirty = true;
    }
    if (this.suppliers.length === 0) {
      this.suppliers = [
        { id: 'sup-eve', code: 'EVE', name: 'EVE Energy Co., Ltd.', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 108.0, ratingScore: 98 },
        { id: 'sup-catl', code: 'CATL', name: 'Contemporary Amperex Technology (CATL)', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 110.0, ratingScore: 99 },
        { id: 'sup-gotion', code: 'GOTION', name: 'Gotion High-Tech Inc.', country: 'China', cellChemistry: 'LFP', nominalCapacityAh: 105.0, ratingScore: 95 },
      ];
      dirty = true;
    }
    if (!isProduction()) {
      const admin = this.users.find(u => u.id === 'usr-admin-01' || u.username === 'admin');
      const bootstrap = process.env.ADMIN_BOOTSTRAP_PASSWORD || DEFAULT_ADMIN_PASSWORD;
      if (admin) {
        admin.email = DEFAULT_ADMIN_EMAIL;
        admin.username = DEFAULT_ADMIN_USERNAME;
        admin.status = 'ACTIVE';
        admin.roleId = 'role-admin';
        admin.role = 'admin';
        admin.passwordHash = hashPassword(bootstrap);
        admin.loginAttempts = 0;
        admin.lockedUntil = null;
        dirty = true;
      }
    }
    return dirty;
  }

  addAuditLog(
    userId: string,
    action: string,
    entityType: 'CELL' | 'MODULE' | 'BATTERY' | 'BMS' | 'ORDER' | 'QC' | 'IMPORT' | 'SYSTEM' | 'AUTH',
    entityId: string,
    oldValue?: string,
    newValue?: string,
    reason?: string
  ) {
    const user = this.users.find(u => u.id === userId) || { name: 'System Auto', role: 'admin' as const };
    const log: AuditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      userId,
      userName: user.name,
      userRole: user.role,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      reason,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 5000) this.auditLogs.pop();
  }

  matchCellsForModule(availableCells: CellItem[], requiredCount: number, rules: any): { matched: CellItem[]; score: number; metrics: any } | null {
    if (availableCells.length < requiredCount) return null;
    const validCells = availableCells.filter(c =>
      c.status === 'AVAILABLE' || c.status === 'RESERVED' || c.status === 'VALIDATING' || c.status === 'PASSED'
    );
    if (validCells.length < requiredCount) return null;
    validCells.sort((a, b) => (a.supplierCapacityAh || 108) - (b.supplierCapacityAh || 108));
    let bestWindow: CellItem[] = [];
    let bestSpread = Infinity;
    for (let i = 0; i <= validCells.length - requiredCount; i++) {
      const window = validCells.slice(i, i + requiredCount);
      const caps = window.map(c => c.productionCapacityAh || c.supplierCapacityAh || 108);
      const ocvs = window.map(c => c.productionOcvV || c.supplierOcvV || 3.30);
      const irs = window.map(c => c.productionIrMilliOhm || c.supplierIrMilliOhm || 0.25);
      const cost = (Math.max(...caps) - Math.min(...caps)) * 10 + (Math.max(...ocvs) - Math.min(...ocvs)) * 1000 + (Math.max(...irs) - Math.min(...irs)) * 20;
      if (cost < bestSpread) {
        bestSpread = cost;
        bestWindow = window;
      }
    }
    if (bestWindow.length < requiredCount) return null;
    const caps = bestWindow.map(c => c.productionCapacityAh || c.supplierCapacityAh || 108);
    const ocvs = bestWindow.map(c => c.productionOcvV || c.supplierOcvV || 3.30);
    const irs = bestWindow.map(c => c.productionIrMilliOhm || c.supplierIrMilliOhm || 0.25);
    return {
      matched: bestWindow,
      score: Math.max(70, Math.min(99.8, Number((100 - (Math.max(...caps) - Math.min(...caps)) * 8 - (Math.max(...ocvs) - Math.min(...ocvs)) * 400 - (Math.max(...irs) - Math.min(...irs)) * 10).toFixed(1)))),
      metrics: {
        avgCapacityAh: Number((caps.reduce((a, b) => a + b, 0) / caps.length).toFixed(4)),
        deltaCapacityAh: Number((Math.max(...caps) - Math.min(...caps)).toFixed(4)),
        avgOcvV: Number((ocvs.reduce((a, b) => a + b, 0) / ocvs.length).toFixed(4)),
        deltaOcvV: Number((Math.max(...ocvs) - Math.min(...ocvs)).toFixed(4)),
        avgIrMilliOhm: Number((irs.reduce((a, b) => a + b, 0) / irs.length).toFixed(4)),
        deltaIrMilliOhm: Number((Math.max(...irs) - Math.min(...irs)).toFixed(4)),
      },
    };
  }
}

export const db = new Database();
