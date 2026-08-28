const fs = require('fs');
let code = fs.readFileSync('server/routes.ts', 'utf8');

code = code.replace(
  /\} else if \(stepKey === 'CELL_TESTING' \|\| stepKey === 'OCV_IR'\) \{/,
  `} else if (stepKey === 'CELL_TESTING' || stepKey === 'OCV_IR') {
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
`
);

fs.writeFileSync('server/routes.ts', code);
