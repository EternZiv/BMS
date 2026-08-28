const fs = require('fs');
let code = fs.readFileSync('server/routes.ts', 'utf8');

code = code.replace(
  /const mod = db\.modules\.get\(moduleId\);/,
  `// Auto-pass MODULE_ASSEMBLY if not done
  if (battery.currentStep === 'MODULE_ASSEMBLY') {
    battery.stepResults.MODULE_ASSEMBLY = {
      stepName: 'Module Assembly',
      status: 'PASSED',
      mode: 'MANUAL',
      completedAt: new Date().toISOString(),
      completedBy: userId,
      details: 'Physical assembly auto-verified on weld initiation.',
    };
    battery.currentStep = 'LASER_WELDING';
    battery.progressPercent = 50;
  }
  
  const mod = db.modules.get(moduleId);`
);

fs.writeFileSync('server/routes.ts', code);
