const fs = require('fs');
let code = fs.readFileSync('src/components/production/VisualBatteryBuilder.tsx', 'utf8');

const handleContinueStr = `  const handleContinue = async () => {
    try {
      if (battery.currentStep === 'CELL_IDENTIFICATION') {
        await api.executeStep(battery.id, 'CELL_IDENTIFICATION', { mode: 'AUTO', userId: currentUser?.id });
      }
      setActiveView('workflow-cell');
    } catch (err: any) {
      addNotification('error', 'Transition Failed', err.message);
    }
  };`;

// Insert the new function before the return statement inside VisualBatteryBuilder
const returnIndex = code.indexOf('return (', code.indexOf('const isComplete'));

code = code.slice(0, returnIndex) + handleContinueStr + '\n\n  ' + code.slice(returnIndex);

// Replace the onClick handler
code = code.replace(
  `onClick={() => setActiveView('workflow-cell')}`,
  `onClick={handleContinue}`
);

fs.writeFileSync('src/components/production/VisualBatteryBuilder.tsx', code);
