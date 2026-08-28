const fs = require('fs');
let code = fs.readFileSync('server/routes.ts', 'utf8');

code = code.replace(
  /primarySupplier = \{\n      id: `sup-\$\{Date.now\(\)\}`,\n      name: firstManufacturer,\n      code: firstManufacturer.substring\(0, 3\).toUpperCase\(\),\n    \};/g,
  `primarySupplier = {
      id: \`sup-\${Date.now()}\`,
      name: firstManufacturer,
      code: firstManufacturer.substring(0, 3).toUpperCase(),
      country: 'Unknown',
      cellChemistry: 'LFP',
      nominalCapacityAh: 100,
      ratingScore: 5
    };`
);

code = code.replace(
  /cellSupplier = \{\n        id: `sup-\$\{Date.now\(\)\}-\$\{i\}`,\n        name: cellManufacturer,\n        code: cellManufacturer.substring\(0, 3\).toUpperCase\(\),\n      \};/g,
  `cellSupplier = {
        id: \`sup-\${Date.now()}-\${i}\`,
        name: cellManufacturer,
        code: cellManufacturer.substring(0, 3).toUpperCase(),
        country: 'Unknown',
        cellChemistry: 'LFP',
        nominalCapacityAh: 100,
        ratingScore: 5
      };`
);

fs.writeFileSync('server/routes.ts', code);
