const fs = require('fs');
let code = fs.readFileSync('server/routes.ts', 'utf8');

const searchRegex = /apiRouter\.post\('\/supplier-imports', \(req, res\) => \{[\s\S]*?(?=apiRouter\.get\('\/supplier-imports')/g;

const newImplementation = `apiRouter.post('/supplier-imports', (req, res) => {
  const { filename, rows, userId = 'usr-1' } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No data rows provided' });
  }

  let validRows = 0;
  let duplicateRows = 0;
  let invalidRows = 0;
  const importedCellIds = [];
  const existingBarcodes = new Set(Array.from(db.cells.values()).map(c => c.supplierBarcode));

  // Auto-detect and collect suppliers
  // Find primary supplier from data or use fallback
  const firstManufacturer = rows.find(r => r.manufacturer_name)?.manufacturer_name || 'Unknown Supplier';
  let primarySupplier = db.suppliers.find(s => s.name.toLowerCase() === firstManufacturer.toLowerCase());
  
  if (!primarySupplier) {
    primarySupplier = {
      id: \`sup-\${Date.now()}\`,
      name: firstManufacturer,
      code: firstManufacturer.substring(0, 3).toUpperCase(),
    };
    db.suppliers.push(primarySupplier);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const barcode = String(row.barcode || '').trim();

    if (!barcode) { invalidRows++; continue; }
    if (existingBarcodes.has(barcode)) { duplicateRows++; continue; }

    const cap = parseFloat(row.capacity);
    const ocv = parseFloat(row.ocv);
    const ir = parseFloat(row.ri);

    if (isNaN(cap) || isNaN(ocv) || isNaN(ir)) {
      invalidRows++;
      continue;
    }

    // Determine supplier per cell if they differ, though we default to primary
    const cellManufacturer = row.manufacturer_name || primarySupplier.name;
    let cellSupplier = db.suppliers.find(s => s.name.toLowerCase() === cellManufacturer.toLowerCase());
    if (!cellSupplier) {
      cellSupplier = {
        id: \`sup-\${Date.now()}-\${i}\`,
        name: cellManufacturer,
        code: cellManufacturer.substring(0, 3).toUpperCase(),
      };
      db.suppliers.push(cellSupplier);
    }

    const cellId = \`cell-imp-\${Date.now()}-\${i}\`;
    const internalSerial = \`P2G-CL-\${String(db.cells.size + 1).padStart(7, '0')}\`;

    const cell = {
      id: cellId,
      internalSerial,
      supplierBarcode: barcode,
      supplierId: cellSupplier.id,
      supplierName: cellManufacturer,
      batchNumber: String(row.group || \`BAT-\${Date.now()}\`),
      palletNumber: String(row.pallet || \`PAL-\${Date.now()}\`),
      boxNumber: String(row.box_number || \`BOX-\${Date.now()}\`),
      manufacturingDate: row.manufacture_date || new Date().toISOString().slice(0, 10),
      supplierCapacityAh: cap,
      supplierOcvV: ocv,
      supplierIrMilliOhm: ir,
      supplierGrade: String(row.gear || 'Grade-A'),
      status: 'AVAILABLE' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.cells.set(cellId, cell);
    existingBarcodes.add(barcode);
    importedCellIds.push(cellId);
    validRows++;
  }

  const importSummary = {
    id: \`imp-\${Date.now()}\`,
    filename: filename || 'supplier_cells_manifest.csv',
    supplierId: primarySupplier.id,
    supplierName: primarySupplier.name,
    totalRows: rows.length,
    validRows,
    duplicateRows,
    invalidRows,
    importedAt: new Date().toISOString(),
    importedBy: userId,
  };

  db.imports.unshift(importSummary);
  db.addAuditLog(userId, \`Imported \${validRows} cells (detected primarily from \${primarySupplier.name}) (\${duplicateRows} duplicates skipped)\`, 'IMPORT', importSummary.id);

  res.json({
    summary: importSummary,
    importedCount: validRows,
  });
});

`;

code = code.replace(searchRegex, newImplementation);
fs.writeFileSync('server/routes.ts', code);
