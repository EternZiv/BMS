const fs = require('fs');
let code = fs.readFileSync('src/components/production/CellWorkflowView.tsx', 'utf8');

code = code.replace(
  `const [manualIr, setManualIr] = useState('');`,
  `const [manualIr, setManualIr] = useState('');\n  const [manualOcv, setManualOcv] = useState('');`
);

code = code.replace(
  `setManualIr((c.productionIrMilliOhm ?? c.supplierIrMilliOhm ?? c.supplierIrMohm ?? '').toString());`,
  `setManualIr((c.productionIrMilliOhm ?? c.supplierIrMilliOhm ?? c.supplierIrMohm ?? '').toString());\n      setManualOcv((c.productionOcvV ?? c.supplierOcvV ?? '').toString());`
);

code = code.replace(
  `ocvV: cell.supplierOcvV,`,
  `ocvV: parseFloat(manualOcv),`
);

code = code.replace(
  /<div>\s*<label className="block text-xs font-bold text-slate-500 uppercase mb-2">Cell \{\w+ \+ 1\} IR \(mΩ\)<\/label>\s*<input[\s\S]*?<\/div>/,
  `<div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Cell {currentCellIndex + 1} OCV (V)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={manualOcv}
                    onChange={(e) => setManualOcv(e.target.value)}
                    className="w-full px-4 py-3 mb-4 text-lg font-mono font-bold text-center border-2 border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 outline-none"
                    required
                  />
                  
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Cell {currentCellIndex + 1} IR (mΩ)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={manualIr}
                    onChange={(e) => setManualIr(e.target.value)}
                    className="w-full px-4 py-3 text-lg font-mono font-bold text-center border-2 border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 outline-none"
                    autoFocus
                    required
                  />
                  <p className="text-[10px] text-slate-400 mt-4 text-center">Supplier Values default. Press ENTER to accept or type a new value.</p>
                </div>`
);

fs.writeFileSync('src/components/production/CellWorkflowView.tsx', code);
