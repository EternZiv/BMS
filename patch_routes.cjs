const fs = require('fs');
let code = fs.readFileSync('server/routes.ts', 'utf8');

// Replace GRADING step handling
const gradingRegex = /\} else if \(stepKey === 'GRADING'\) \{[\s\S]*?(?=\} else if \(stepKey === 'MODULE_ASSEMBLY'\) \{)/;

const newGrading = `} else if (stepKey === 'GRADING') {
    const { cellId, grade, remarks } = req.body;
    let cellsToTest = [];
    battery.modules.forEach(m => m.cells.forEach(c => cellsToTest.push(c)));
    if (cellsToTest.length === 0) {
      cellsToTest = Array.from(db.cells.values()).filter(c => c.reservedForBatteryId === id);
    }
    
    if (cellId) {
      const cell = cellsToTest.find(c => c.id === cellId);
      if (cell) {
        cell.productionGrade = grade;
        if (remarks) cell.quarantineReason = remarks; // store remarks
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
      battery.stepResults.CELL_MATCHING = {
        stepName: 'Module Cell Matching',
        status: 'READY',
        mode: 'AUTO',
      };
      // Skip matching and jump to module assembly to simplify
      battery.currentStep = 'MODULE_ASSEMBLY';
      battery.progressPercent = 35;
    } else {
      battery.stepResults.GRADING = {
        stepName: 'Cell Grading',
        status: 'READY',
        mode: 'MANUAL',
      };
    }
  `;

code = code.replace(gradingRegex, newGrading);
fs.writeFileSync('server/routes.ts', code);
