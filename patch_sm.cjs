const fs = require('fs');
let code = fs.readFileSync('server/routes.ts', 'utf8');

// Allow CELL_TESTING from CELL_IDENTIFICATION
code = code.replace(
  /'CELL_IDENTIFICATION': \['CELL_IDENTIFICATION'\],/,
  `'CELL_IDENTIFICATION': ['CELL_IDENTIFICATION', 'CELL_TESTING'],`
);

fs.writeFileSync('server/routes.ts', code);
