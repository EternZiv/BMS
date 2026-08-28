import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Supplier, SupplierImportSummary } from '../../types';
import {
  Truck,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Download,
  Sparkles,
  RefreshCw,
  Boxes,
  Layers,
  XCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface ParsedRow {
  index: number;
  barcode?: string;
  capacity?: number;
  ocv?: number;
  ri?: number;
  gear?: string;
  box_number?: string;
  pallet?: string;
  group?: string;
  manufacturer_name?: string;
  manufacture_date?: string;
  isValid: boolean;
  errors: string[];
}

export const SupplierImportView: React.FC = () => {
  const { addNotification, triggerRefresh, refreshKey } = useApp();
  const { currentUser } = useAuth();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ summary: SupplierImportSummary; importedCount: number } | null>(null);

  // New Validation State
  const [parsedFileName, setParsedFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [headersFound, setHeadersFound] = useState<Record<string, boolean>>({});
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    loadData();
  }, [refreshKey]);

  const loadData = async () => {
    try {
      const sups = await api.getSuppliers();
      setSuppliers(sups);
    } catch (err) {
      console.error('Failed to load supplier data', err);
    }
  };

  const normalizeHeader = (h: string) => h.toLowerCase().trim().replace(/[\s-]+/g, '_');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setPreviewMode(false);
    setParsedFileName(file.name);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        
        let targetSheet = workbook.SheetNames.find(s => s.toLowerCase().includes('celltemplate')) || workbook.SheetNames[0];
        const sheet = workbook.Sheets[targetSheet];
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        if (rawData.length < 2) {
          throw new Error('File is empty or missing data rows');
        }

        const headers = rawData[0].map(h => normalizeHeader(String(h || '')));
        
        // Canonical headers
        const headerAliases: Record<string, string[]> = {
          barcode: ['barcode', 'supplier_barcode', 'supplier_serial', 'cell_barcode', 'serial_number', 'serial'],
          capacity: ['capacity', 'capacity_ah', 'nominal_capacity', 'nominal_capacity_ah'],
          ocv: ['ocv', 'ocv_v', 'open_circuit_voltage', 'open_circuit_voltage_v'],
          ri: ['ri', 'ir', 'ir_mohm', 'resistance', 'internal_resistance'],
          gear: ['gear', 'grade', 'grading', 'cell_grade'],
          box_number: ['box_number', 'box', 'box_no'],
          pallet: ['pallet', 'pallet_number', 'pallet_no'],
          group: ['group', 'batch', 'batch_number', 'lot', 'lot_number'],
          manufacturer_name: ['manufacturer_name', 'manufacturer', 'supplier', 'supplier_name'],
          manufacture_date: ['manufacture_date', 'manufacturing_date', 'production_date', 'date'],
        };
        const canonical = Object.keys(headerAliases);
        
        const hFound: Record<string, boolean> = {};
        const hIndex: Record<string, number> = {};
        
        canonical.forEach(ch => {
          const idx = headers.findIndex(h => headerAliases[ch].includes(h));
          hFound[ch] = idx !== -1;
          hIndex[ch] = idx;
        });
        
        setHeadersFound(hFound);

        const rows: ParsedRow[] = [];
        for (let i = 1; i < rawData.length; i++) {
          const rowData = rawData[i];
          if (!rowData || rowData.length === 0) continue;
          
          let hasAnyData = false;
          for(let d of rowData) if(d !== undefined && d !== null && String(d).trim() !== '') hasAnyData = true;
          if(!hasAnyData) continue;

          const row: ParsedRow = { index: i, isValid: true, errors: [] };

          const getVal = (colName: string) => {
            const idx = hIndex[colName];
            return idx !== -1 ? rowData[idx] : undefined;
          };

          row.barcode = getVal('barcode') ? String(getVal('barcode')).trim() : undefined;
          if (!row.barcode) { row.isValid = false; row.errors.push('Missing barcode'); }

          const capacityValue = getVal('capacity');
          const cap = parseFloat(capacityValue);
          if (capacityValue !== undefined && capacityValue !== null && String(capacityValue).trim() !== '') {
            if (isNaN(cap)) { row.isValid = false; row.errors.push('Invalid capacity'); } else row.capacity = cap;
          }

          const ocvValue = getVal('ocv');
          const ocv = parseFloat(ocvValue);
          if (ocvValue !== undefined && ocvValue !== null && String(ocvValue).trim() !== '') {
            if (isNaN(ocv)) { row.isValid = false; row.errors.push('Invalid ocv'); } else row.ocv = ocv;
          }

          const riValue = getVal('ri');
          const ri = parseFloat(riValue);
          if (riValue !== undefined && riValue !== null && String(riValue).trim() !== '') {
            if (isNaN(ri)) { row.isValid = false; row.errors.push('Invalid ri'); } else row.ri = ri;
          }

          row.gear = getVal('gear') ? String(getVal('gear')) : undefined;

          row.box_number = getVal('box_number') ? String(getVal('box_number')) : undefined;
          row.pallet = getVal('pallet') ? String(getVal('pallet')) : undefined;
          row.group = getVal('group') ? String(getVal('group')) : undefined;
          row.manufacturer_name = getVal('manufacturer_name') ? String(getVal('manufacturer_name')) : undefined;

          let dateVal = getVal('manufacture_date');
          if (dateVal instanceof Date) {
            row.manufacture_date = dateVal.toISOString().slice(0, 10);
          } else if (dateVal) {
            row.manufacture_date = String(dateVal);
          }

          rows.push(row);
        }

        setParsedRows(rows);
        setPreviewMode(true);
      } catch (err: any) {
        addNotification('error', 'File Parse Error', err.message);
      } finally {
        setLoading(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const confirmImport = async () => {
    setLoading(true);
    try {
      // Map Canonical payload
      const payloadRows = parsedRows.filter(r => r.isValid).map(r => ({
        barcode: r.barcode,
        capacity: r.capacity,
        ocv: r.ocv,
        ri: r.ri,
        gear: r.gear,
        box_number: r.box_number,
        pallet: r.pallet,
        group: r.group,
        manufacturer_name: r.manufacturer_name,
        manufacture_date: r.manufacture_date
      }));

      const res = await api.importSupplierCells({
        filename: parsedFileName,
        rows: payloadRows,
        userId: currentUser.id,
      });

      setImportResult(res);
      addNotification('success', 'File Imported', `Imported ${res.importedCount} cells`);
      triggerRefresh();
      setPreviewMode(false);
    } catch (err: any) {
      addNotification('error', 'Import Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const allHeadersFound = Object.values(headersFound).every(Boolean);

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 flex items-center space-x-3">
        <span className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl">
          <Truck className="w-5 h-5" />
        </span>
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
            Supplier Manifest & Receiving
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Strict column mapping and validation for Excel/CSV manifests.
          </p>
        </div>
      </div>

      {!previewMode && !importResult && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
          <h2 className="text-sm font-bold text-slate-900">Upload Manifest</h2>

          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-7 text-center relative hover:border-emerald-500">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <FileSpreadsheet className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-bold text-slate-800">Drag & Drop Excel / CSV Manifest</p>
            <p className="text-[11px] text-slate-400 mt-1">Extracts canonical 10 columns strictly.</p>
          </div>
        </div>
      )}

      {previewMode && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
          <h2 className="text-sm font-bold text-slate-900">Import Validation & Preview</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Object.entries(headersFound).map(([header, found]) => (
              <div key={header} className={`p-2 text-xs rounded border ${found ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-900 border-slate-800 text-white'}`}>
                {found ? <CheckCircle2 className="inline w-3 h-3 mr-1" /> : <AlertTriangle className="inline w-3 h-3 mr-1 text-yellow-400" />}
                {header}
              </div>
            ))}
          </div>

          {!allHeadersFound && (
            <div className="p-3 bg-slate-900 text-white text-xs rounded">
              Warning: Some canonical headers were not detected.
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 text-center border-y border-slate-100 py-3">
             <div><span className="block text-xl font-black text-slate-900">{parsedRows.length}</span><span className="text-xs text-slate-500">Total Rows</span></div>
             <div><span className="block text-xl font-black text-emerald-600">{parsedRows.filter(r => r.isValid).length}</span><span className="text-xs text-slate-500">Valid</span></div>
             <div><span className="block text-xl font-black text-slate-900">{parsedRows.filter(r => !r.isValid).length}</span><span className="text-xs text-slate-500">Invalid</span></div>
          </div>

          <div className="max-h-[300px] overflow-auto border border-slate-200 rounded">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-500 sticky top-0">
                <tr>
                  <th className="p-2">Row</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Barcode</th>
                  <th className="p-2">Capacity</th>
                  <th className="p-2">OCV</th>
                  <th className="p-2">RI</th>
                  <th className="p-2">Errors</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="p-2">{r.index}</td>
                    <td className="p-2">{r.isValid ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-slate-900" />}</td>
                    <td className="p-2 font-mono">{r.barcode || '-'}</td>
                    <td className="p-2">{r.capacity || '-'}</td>
                    <td className="p-2">{r.ocv || '-'}</td>
                    <td className="p-2">{r.ri || '-'}</td>
                    <td className="p-2 text-slate-900">{r.errors.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedRows.length > 50 && <p className="text-center text-xs p-2 text-slate-500">Showing first 50 rows...</p>}
          </div>

          <div className="flex space-x-3">
             <button onClick={confirmImport} disabled={loading} className="px-5 py-2 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-500">
               {loading ? 'Importing...' : `IMPORT ${parsedRows.filter(r => r.isValid).length} VALID RECORDS`}
             </button>
             <button onClick={() => setPreviewMode(false)} className="px-5 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded hover:bg-slate-200">
               Cancel
             </button>
          </div>
        </div>
      )}

      {importResult && (
         <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 text-center space-y-4">
           <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
             <CheckCircle2 className="w-8 h-8" />
           </div>
           <h2 className="text-xl font-black text-slate-900">IMPORT COMPLETE</h2>
           <div className="max-w-md mx-auto grid grid-cols-2 gap-4 text-left">
             <div className="p-3 bg-slate-50 rounded border border-slate-100">
               <span className="block text-xs text-slate-500">Total Rows</span>
               <span className="block text-lg font-bold">{importResult.summary.totalRows}</span>
             </div>
             <div className="p-3 bg-emerald-50 rounded border border-emerald-100">
               <span className="block text-xs text-emerald-700">Imported</span>
               <span className="block text-lg font-bold text-emerald-700">{importResult.summary.validRows}</span>
             </div>
             <div className="p-3 bg-slate-100 rounded border border-slate-200">
               <span className="block text-xs text-slate-600">Duplicates Skipped</span>
               <span className="block text-lg font-bold text-slate-800">{importResult.summary.duplicateRows}</span>
             </div>
             <div className="p-3 bg-slate-900 rounded border border-slate-800">
               <span className="block text-xs text-slate-300">Invalid / Rejected</span>
               <span className="block text-lg font-bold text-white">{importResult.summary.invalidRows}</span>
             </div>
           </div>
           <button onClick={() => setImportResult(null)} className="px-5 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded mt-4">
             Import Another File
           </button>
         </div>
      )}
    </div>
  );
};
