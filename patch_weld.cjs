const fs = require('fs');
let code = fs.readFileSync('server/routes.ts', 'utf8');

code = code.replace(
  /const \{ mode = 'AUTO', machineId = 'MC-WELD-01', userId = 'usr-3', manualParams \} = req.body;/,
  `const { mode = 'AUTO', machineId = 'MC-WELD-01', userId = 'usr-3', manualParams, status = 'PASSED' } = req.body;`
);

code = code.replace(
  /weldResult = \{[\s\S]*?status: 'PASSED' as const,[\s\S]*?machineId: 'MANUAL_OVERRIDE',[\s\S]*?\};/,
  `weldResult = {
      status: status as any,
      machineId: 'MANUAL_OVERRIDE',
      laserPowerWatts: manualParams?.laserPowerWatts || 2800,
      weldTimeMs: manualParams?.weldTimeMs || 4200,
      pullForceKg: manualParams?.pullForceKg || 18.2,
      weldedAt: new Date().toISOString(),
      operatorId: userId,
    };`
);

fs.writeFileSync('server/routes.ts', code);
