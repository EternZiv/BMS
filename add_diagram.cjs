const fs = require('fs');
let code = fs.readFileSync('src/components/dashboard/DashboardView.tsx', 'utf8');

const diagramHtml = `
      {/* Workflow Diagram */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden mt-8 text-white p-6">
        <h2 className="text-sm font-bold uppercase tracking-wider mb-6 text-emerald-400">Power2Go Authoritative Manufacturing Flow</h2>
        <div className="font-mono text-[10px] sm:text-xs whitespace-pre bg-black/50 p-6 rounded-xl border border-slate-800 overflow-x-auto text-slate-300">
{\`===========================================================
CORE HIERARCHY
===========================================================

SUPPLIER EXCEL DATA
        ↓
2D BATTERY BUILDER
      ├── CELL SCAN
      └── BMS/BMU SCAN
        ↓
CELL WORKFLOW (Cell-by-Cell)
      ├── IR & OCV
      ├── GRADING (Good/Damaged)
      └── DAMAGE HISTORY (if required)
        ↓
MODULE WORKFLOW (Module-by-Module)
      ├── LASER WELDING
      ├── QC PHYSICAL
      └── QC VOLTAGE
        ↓
BATTERY PACK WORKFLOW (Global)
      ├── PACK ASSEMBLY
      ├── PACK IR
      └── FINAL QC
        ↓
RELEASE
        ↓
QR + INVENTORY + GENEALOGY\`}
        </div>
      </div>
`;

// Insert before the last </div>
const parts = code.split('</div>\n    </div>\n  );\n};\n');
if (parts.length === 2) {
  code = parts[0] + diagramHtml + '\n    </div>\n    </div>\n  );\n};\n';
  fs.writeFileSync('src/components/dashboard/DashboardView.tsx', code);
}
