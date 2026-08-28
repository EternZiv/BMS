const fs = require('fs');
let code = fs.readFileSync('server/routes.ts', 'utf8');

const routeStart = code.indexOf(`apiRouter.post('/batteries/:id/steps/:stepKey/execute'`);
if (routeStart === -1) throw new Error("Could not find execute route");

const routeEnd = code.indexOf(`apiRouter.get('/machines'`, routeStart);
if (routeEnd === -1) throw new Error("Could not find end of execute route");

const replacement = `apiRouter.post('/batteries/:id/steps/:stepKey/execute', async (req, res) => {
  const { id, stepKey } = req.params;
  const { mode = 'AUTO', reuseSupplierData = false, manualValues, bypassReason, bypassPin, userId = 'usr-3', cellId, grade, remarks } = req.body;

  const battery = db.batteries.get(id);
  if (!battery) return res.status(404).json({ error: 'Battery not found' });

  // STRICT TRANSITION VALIDATION
  const validTransitions: Record<string, string[]> = {
    'CELL_IDENTIFICATION': ['CELL_IDENTIFICATION', 'CELL_TESTING'],
    'CELL_TESTING': ['CELL_TESTING', 'OCV_IR', 'GRADING'],
    'GRADING': ['GRADING', 'MODULE_ASSEMBLY'],
    'CELL_MATCHING': ['CELL_MATCHING', 'MODULE_ASSEMBLY'],
    'MODULE_ASSEMBLY': ['MODULE_ASSEMBLY', 'LASER_WELDING'],
    'LASER_WELDING': ['LASER_WELDING', 'MODULE_QC'],
    'MODULE_QC': ['MODULE_QC', 'BATTERY_ASSEMBLY'],
    'BATTERY_ASSEMBLY': ['BATTERY_ASSEMBLY', 'BMS_INTEGRATION'],
    'BMS_INTEGRATION': ['BMS_INTEGRATION', 'FINAL_TESTING'],
    'FINAL_TESTING': ['FINAL_TESTING', 'FINAL_QC'],
    'FINAL_QC': ['FINAL_QC'],
  };

  const allowedTargets = validTransitions[battery.currentStep] || [];
  if (!allowedTargets.includes(stepKey)) {
    return res.status(400).json({
      error: \`State Machine Exception: Out-of-order transition blocked. Current battery step is [\${battery.currentStep}], cannot execute [\${stepKey}].\`
    });
  }

  // Handle Supervisor BYPASS mode with audit
  if (mode === 'BYPASS') {
    if (!bypassReason) {
      return res.status(400).json({ error: 'Bypass requires an explicit justification reason' });
    }

    battery.stepResults[stepKey] = {
      stepName: stepKey,
      status: 'BYPASSED',
      mode: 'BYPASS',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: \`BYPASS AUTHORIZED: \${bypassReason}\`,
    };

    if (stepKey === 'CELL_IDENTIFICATION') {
      battery.currentStep = 'CELL_TESTING';
      battery.progressPercent = 15;
    } else if (stepKey === 'CELL_TESTING' || stepKey === 'OCV_IR') {
      battery.currentStep = 'GRADING';
      battery.progressPercent = 25;
    } else if (stepKey === 'GRADING') {
      battery.currentStep = 'MODULE_ASSEMBLY';
      battery.progressPercent = 35;
    } else if (stepKey === 'MODULE_ASSEMBLY') {
      battery.currentStep = 'LASER_WELDING';
      battery.progressPercent = 50;
    } else if (stepKey === 'BATTERY_ASSEMBLY') {
      battery.currentStep = 'BMS_INTEGRATION';
      battery.progressPercent = 75;
    }
    
    battery.updatedAt = new Date().toISOString();
    db.addAuditLog(userId, \`SUPERVISOR BYPASS applied to Step [\${stepKey}] on Battery \${battery.serialNumber}\`, 'BATTERY', id, 'PENDING', 'BYPASSED', bypassReason);
    
    return res.json({ success: true, battery });
  }

  // Handle Step Logic
  if (stepKey === 'CELL_IDENTIFICATION') {
    battery.stepResults.CELL_IDENTIFICATION = {
      stepName: 'Cell Identification & Verification',
      status: 'PASSED',
      mode: 'AUTO',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'All component serials successfully scanned and verified.',
    };
    battery.stepResults.CELL_TESTING = {
      stepName: 'OCV & IR Testing',
      status: 'READY',
      mode: 'AUTO',
    };
    battery.currentStep = 'CELL_TESTING';
    battery.progressPercent = 15;
    
  } else if (stepKey === 'CELL_TESTING' || stepKey === 'OCV_IR') {
    if (battery.currentStep === 'CELL_IDENTIFICATION') {
      battery.stepResults.CELL_IDENTIFICATION = {
        stepName: 'Cell Identification & Verification',
        status: 'PASSED',
        mode: 'AUTO',
        completedAt: new Date().toISOString(),
        completedBy: userId,
        details: 'All component serials successfully scanned and verified.',
      };
      battery.currentStep = 'CELL_TESTING';
      battery.progressPercent = 15;
    }
  
    // Gather all cells in battery
    const cellsToTest: any[] = [];
    battery.modules.forEach(m => m.cells.forEach(c => cellsToTest.push(c)));
    if (cellsToTest.length === 0) {
      Array.from(db.cells.values())
        .filter(c => c.reservedForBatteryId === id)
        .forEach(c => cellsToTest.push(c));
    }

    if (cellId) {
      const singleCell = cellsToTest.find(c => c.id === cellId);
      if (singleCell) {
        singleCell.productionOcvV = manualValues?.ocvV !== undefined ? Number(manualValues.ocvV) : singleCell.supplierOcvV;
        singleCell.productionIrMilliOhm = manualValues?.irMilliOhm !== undefined ? Number(manualValues.irMilliOhm) : singleCell.supplierIrMilliOhm;
        singleCell.productionIrMohm = manualValues?.irMilliOhm !== undefined ? Number(manualValues.irMilliOhm) : singleCell.supplierIrMilliOhm;
        singleCell.productionCapacityAh = singleCell.supplierCapacityAh;
        singleCell.measurementMethod = 'MANUAL';
        singleCell.testedAt = new Date().toISOString();
        singleCell.testedBy = userId;
        singleCell.status = 'PASSED';
      }
    }

    const allCellsTested = cellsToTest.length > 0 && cellsToTest.every(c => c.productionOcvV !== undefined && c.productionOcvV !== null);
    
    if (allCellsTested) {
      battery.stepResults.CELL_TESTING = {
        stepName: 'OCV & IR Testing',
        status: 'PASSED',
        mode: mode || 'AUTO',
        completedAt: new Date().toISOString(),
        completedBy: userId,
        details: \`\${cellsToTest.length} cells fully tested\`,
      };
      battery.stepResults.GRADING = {
        stepName: 'Cell Grading',
        status: 'READY',
        mode: 'MANUAL',
      };
      battery.currentStep = 'GRADING';
      battery.progressPercent = 25;
    } else {
      const testedCount = cellsToTest.filter(c => c.productionOcvV !== undefined && c.productionOcvV !== null).length;
      battery.stepResults.CELL_TESTING = {
        stepName: 'OCV & IR Testing',
        status: 'READY',
        mode: mode || 'AUTO',
        details: \`\${testedCount}/\${cellsToTest.length} cells verified.\`,
      };
    }
    
  } else if (stepKey === 'GRADING') {
    let cellsToTest = [];
    battery.modules.forEach(m => m.cells.forEach(c => cellsToTest.push(c)));
    if (cellsToTest.length === 0) {
      cellsToTest = Array.from(db.cells.values()).filter(c => c.reservedForBatteryId === id);
    }
    
    if (cellId) {
      const cell = cellsToTest.find(c => c.id === cellId);
      if (cell) {
        cell.productionGrade = grade;
        if (remarks) cell.quarantineReason = remarks;
      }
    }
    
    const allCellsGraded = cellsToTest.length > 0 && cellsToTest.every(c => !!c.productionGrade);
    
    if (allCellsGraded) {
      battery.stepResults.GRADING = {
        stepName: 'Cell Grading',
        status: 'PASSED',
        mode: 'MANUAL',
        completedAt: new Date().toISOString(),
        completedBy: userId,
        details: 'All cells have been manually graded.',
      };
      battery.stepResults.MODULE_ASSEMBLY = {
        stepName: 'Module Assembly',
        status: 'READY',
        mode: 'MANUAL',
      };
      battery.currentStep = 'MODULE_ASSEMBLY';
      battery.progressPercent = 35;
    } else {
      battery.stepResults.GRADING = {
        stepName: 'Cell Grading',
        status: 'READY',
        mode: 'MANUAL',
      };
    }
    
  } else if (stepKey === 'MODULE_ASSEMBLY') {
    battery.stepResults.MODULE_ASSEMBLY = {
      stepName: 'Module Assembly',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'Cells physical positioning and busbar fitting verified.',
    };
    battery.stepResults.LASER_WELDING = {
      stepName: 'Laser Busbar Welding',
      status: 'READY',
      mode: 'AUTO',
    };
    battery.currentStep = 'LASER_WELDING';
    battery.progressPercent = 50;
    
  } else if (stepKey === 'BATTERY_ASSEMBLY') {
    battery.stepResults.BATTERY_ASSEMBLY = {
      stepName: 'Battery Enclosure Assembly',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'Physical enclosure and wiring confirmed.',
    };
    battery.stepResults.BMS_INTEGRATION = {
      stepName: 'BMS Harness & Comms Testing',
      status: 'READY',
      mode: 'AUTO',
    };
    battery.currentStep = 'BMS_INTEGRATION';
    battery.progressPercent = 75;
  }

  battery.updatedAt = new Date().toISOString();
  db.addAuditLog(userId, \`Executed Step [\${stepKey}] on Battery \${battery.serialNumber}\`, 'BATTERY', id);

  return res.json({ success: true, battery });
});

`;

code = code.slice(0, routeStart) + replacement + code.slice(routeEnd);

fs.writeFileSync('server/routes.ts', code);
