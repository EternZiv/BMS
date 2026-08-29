import React from 'react';
import { Download, Printer, X } from 'lucide-react';
import type { BatteryUnit, ModuleItem } from '../../types';

interface BatteryReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  battery: BatteryUnit | null;
}

const formatNumber = (value?: number | null, digits = 3) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
};

const flattenCells = (battery: BatteryUnit) => {
  const modules: ModuleItem[] = Array.isArray(battery.modules) ? battery.modules : [];
  const rows: Array<{
    moduleIndex: number;
    moduleSerial: string;
    slot: number;
    cellId: string;
    internalSerial: string;
    supplierBarcode: string;
    supplierOcvV: number;
    supplierIrMilliOhm: number;
    productionOcvV?: number;
    productionIrMilliOhm?: number;
    productionGrade?: string;
    status: string;
  }> = [];

  modules.forEach((module, moduleIndex) => {
    (module.cells || []).forEach((cell, slotIndex) => {
      rows.push({
        moduleIndex: moduleIndex + 1,
        moduleSerial: module.serialNumber,
        slot: slotIndex + 1,
        cellId: cell.id,
        internalSerial: cell.internalSerial,
        supplierBarcode: cell.supplierBarcode,
        supplierOcvV: Number(cell.supplierOcvV ?? 0),
        supplierIrMilliOhm: Number(cell.supplierIrMilliOhm ?? cell.supplierIrMohm ?? 0),
        productionOcvV: cell.productionOcvV ?? undefined,
        productionIrMilliOhm: cell.productionIrMilliOhm ?? undefined,
        productionGrade: cell.productionGrade ?? cell.supplierGrade,
        status: cell.status,
      });
    });
  });

  return rows;
};

export const BatteryReportModal: React.FC<BatteryReportModalProps> = ({ isOpen, onClose, battery }) => {
  if (!isOpen || !battery) return null;

  const modules = Array.isArray(battery.modules) ? battery.modules : [];
  const totalCells = modules.reduce((sum, module) => sum + (module.cells?.length || 0), 0);
  const bms = battery.bms;
  const bmu = battery.bmu;
  const controller = bmu || bms;
  const controllerName = bmu ? 'BMU' : bms ? 'BMS' : 'Controller';
  const cellRows = flattenCells(battery);

  const downloadReport = () => {
    const printable = document.getElementById('battery-report-printable');
    if (!printable) return;
    const html = printable.outerHTML;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${battery.serialNumber}_report.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const printable = document.getElementById('battery-report-printable');
    if (!printable) return;

    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=900');
    if (!printWindow) {
      window.alert('Please allow pop-ups to save this report as PDF.');
      return;
    }

    const printStyles = `
      @page { size: A4 portrait; margin: 10mm; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #2e2e2e;
        font-family: 'Segoe UI', Arial, sans-serif;
      }
      body { display: block; }
      .report-page {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        background: #ffffff;
        box-sizing: border-box;
      }
      .report-page .topbar {
        position: relative;
        height: 36mm;
        background: linear-gradient(135deg, #2e2e2e 0%, #2e2e2e 55%, #2e2e2e 100%);
        overflow: hidden;
        padding: 0 12mm;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .report-page .topbar::before {
        content: "";
        position: absolute;
        inset: 0;
        background-image: repeating-linear-gradient(115deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 9px);
        z-index: 0;
      }
      .report-page .topbar::after {
        content: "";
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        width: 95mm;
        background: linear-gradient(160deg, #5CAE3A 0%, #5ea61a 60%, #3d7a10 100%);
        clip-path: polygon(20% 0, 100% 0, 100% 100%, 0% 100%);
        z-index: 1;
        opacity: 0.9;
      }
      .report-page .brand,
      .report-page .report-badge {
        position: relative;
        z-index: 2;
      }
      .report-page .brand {
        display: flex;
        flex-direction: column;
        gap: 2.6mm;
      }
      .report-page .brand-mark {
        font-size: 6.2pt;
        letter-spacing: 2.5px;
        text-transform: uppercase;
        color: #c7cdc3;
        font-weight: 600;
      }
      .report-page .brand-title {
        font-size: 15pt;
        font-weight: 700;
        letter-spacing: -0.3px;
        color: #ffffff;
      }
      .report-page .report-badge {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(242,183,5,0.55);
        color: #e6f7d9;
        font-size: 7.5pt;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        padding: 1.8mm 3mm;
        border-radius: 2px;
      }
      .report-page .title-band {
        padding: 4mm 12mm 3mm;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        border-bottom: 1.5px solid #2e2e2e;
      }
      .title-band .eyebrow {
        font-size: 7.5pt;
        letter-spacing: 2.5px;
        color: #3d7a10;
        font-weight: 600;
        text-transform: uppercase;
        margin-bottom: 3mm;
      }
      .title-band h2 {
        font-size: 15pt;
        font-weight: 700;
        color: #2e2e2e;
        letter-spacing: -0.3px;
        margin: 0;
      }
      .title-band .doc-plate {
        text-align: right;
      }
      .title-band .doc-plate .id-label {
        display: block;
        font-size: 6.5pt;
        color: #8a939b;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        margin-bottom: 1.5mm;
      }
      .title-band .doc-plate .id {
        display: inline-block;
        background: #f4f6f3;
        border: 1px solid #e1e4e0;
        border-left: 4px solid #5ea61a;
        padding: 3mm 5mm;
        font-weight: 700;
        font-size: 13pt;
        color: #2e2e2e;
      }
      .report-page .summary-strip {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0;
        background: #f4f6f3;
        border-bottom: 1px solid #e1e4e0;
        padding: 2.5mm 12mm;
      }
      .summary-strip .stat {
        padding: 0 6mm;
        border-right: 1px solid #e1e4e0;
      }
      .summary-strip .stat:last-child { border-right: none; }
      .summary-strip .stat-label {
        display: block;
        font-size: 6.3pt;
        letter-spacing: 1.3px;
        text-transform: uppercase;
        color: #8a939b;
        font-weight: 600;
        margin-bottom: 1.3mm;
      }
      .summary-strip .stat-value {
        font-size: 12pt;
        font-weight: 700;
        color: #2e2e2e;
      }
      .summary-strip .stat-value.accent { color: #3d7a10; }
      .report-page .report-grid {
        padding: 20px 12mm 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .report-page .panel {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 16px 18px;
      }
      .report-page .panel h3 {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: #4b5563;
        margin: 0 0 12px;
      }
      .report-page .kv {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px 12px;
        font-size: 12px;
        color: #334155;
      }
      .report-page .kv span:nth-child(odd) {
        color: #64748b;
        font-weight: 600;
      }
      .report-page .module-grid {
        padding: 20px 12mm 16px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
      }
      .report-page .module-card {
        border: 1px solid #dfe8e0;
        background: linear-gradient(180deg, #f9fff9 0%, #ffffff 100%);
        border-radius: 12px;
        padding: 14px;
      }
      .report-page .module-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .report-page .module-name {
        font-weight: 800;
        color: #0f172a;
        font-size: 12px;
      }
      .report-page .module-status {
        background: #ecfdf5;
        color: #047857;
        border: 1px solid #bbf7d0;
        border-radius: 999px;
        padding: 5px 8px;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      .report-page .module-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .report-page .cell-tag {
        background: #f8fafc;
        border: 1px solid #dbe2ea;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 10px;
        font-weight: 700;
        color: #334155;
      }
      .report-page .report-table-wrap { padding: 0 12mm 24px; }
      .report-page .report-table {
        width: 100%;
        border-collapse: collapse;
        border: 1px solid #dfe5de;
        table-layout: fixed;
      }
      .report-page .report-table th,
      .report-page .report-table td {
        border-bottom: 1px solid #e5e7eb;
        padding: 8px 8px;
        text-align: left;
        vertical-align: top;
        font-size: 10px;
        line-height: 1.35;
        word-break: break-word;
      }
      .report-page .report-table th {
        background: #f8fafc;
        color: #475569;
        font-size: 8.5pt;
        letter-spacing: 1.3px;
        text-transform: uppercase;
        font-weight: 800;
      }
      .report-page .report-table tbody tr:nth-child(even) { background: #fcfdfd; }
    `;

    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8" /><title>${battery.serialNumber} Battery Report</title><style>${printStyles}</style></head><body>${printable.outerHTML}</body></html>`);
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  return (
    <div className="battery-report-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
      <style>{`
        @media print {
          body {
            background: #d9d9d9 !important;
          }
          .battery-report-modal .report-header-actions {
            display: none !important;
          }
          .battery-report-modal .report-shell {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
          }
          @page {
            size: A4 portrait;
            margin: 7mm;
          }
        }

        .battery-report-modal {
          background: rgba(15, 23, 42, 0.7);
          font-family: 'Segoe UI', Arial, sans-serif;
        }

        .battery-report-modal .report-shell {
          width: min(980px, 100%);
          max-height: 92vh;
          overflow: auto;
          background: #ffffff;
          border-radius: 0;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25);
        }

        .report-page {
          width: 100%;
          max-width: 980px;
          min-height: 1000px;
          margin: 0 auto;
          background: #f5f5f3;
          color: #1f1f1f;
          overflow: hidden;
        }

        .report-page .topbar {
          position: relative;
          padding: 28px 36px 18px 36px;
          min-height: 130px;
          background: linear-gradient(135deg, #1f1f1f 0%, #1f1f1f 65%, #272b2b 100%);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          overflow: hidden;
        }

        .report-page .topbar::after {
          content: "";
          position: absolute;
          right: -70px;
          top: 0;
          width: 430px;
          height: 100%;
          background: linear-gradient(135deg, #7CCB42 0%, #70C73D 35%, #4FA51D 100%);
          clip-path: polygon(20% 0, 100% 0, 100% 100%, 0% 100%);
        }

        .report-page .brand {
          position: relative;
          z-index: 1;
          margin-top: 10px;
        }

        .report-page .brand-mark {
          display: block;
          font-size: 62px;
          line-height: 0.9;
          font-weight: 900;
          letter-spacing: -4px;
          color: #fff;
        }

        .report-page .brand-mark .green {
          color: #8ddd49;
        }

        .report-page .brand-sub {
          display: block;
          margin-top: 6px;
          margin-left: 8px;
          font-size: 10px;
          letter-spacing: 3px;
          color: rgba(255,255,255,0.74);
          text-transform: uppercase;
          font-weight: 600;
        }

        .report-page .topbar-meta {
          position: relative;
          z-index: 1;
          margin-top: 18px;
          font-size: 11px;
          color: #ffffff;
          text-align: right;
          line-height: 1.5;
          font-weight: 600;
        }

        .report-page .topbar-meta strong {
          color: #dfe7dd;
          font-size: 10px;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .report-page .report-body {
          background: #f3f3f1;
          padding: 0 18px 18px;
        }

        .report-page .report-header-row {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          padding: 18px 8px 12px;
          border-bottom: 1px solid #d8d8d5;
        }

        .report-page .eyebrow {
          display: inline-block;
          font-size: 10px;
          letter-spacing: 2px;
          color: #6c6d6b;
          text-transform: uppercase;
          font-weight: 700;
          margin-bottom: 8px;
        }

        .report-page .report-title {
          font-size: 24px;
          line-height: 1.1;
          margin: 0;
          font-weight: 800;
          color: #1f1f1f;
        }

        .report-page .pack-box {
          min-width: 260px;
          background: rgba(255,255,255,0.4);
          border: 1px solid #d8d8d5;
          border-left: 4px solid #7ad148;
          padding: 10px 16px;
          text-align: left;
        }

        .report-page .pack-box .label {
          display: block;
          font-size: 9px;
          letter-spacing: 2px;
          color: #7c7d78;
          text-transform: uppercase;
          font-weight: 700;
          margin-bottom: 5px;
        }

        .report-page .pack-box .value {
          display: block;
          font-size: 18px;
          font-weight: 800;
          color: #1f1f1f;
        }

        .report-page .summary-row {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 0;
          border-bottom: 1px solid #d8d8d5;
          background: rgba(255,255,255,0.28);
        }

        .report-page .summary-item {
          padding: 12px 14px;
          border-right: 1px solid #d8d8d5;
        }

        .report-page .summary-item:last-child {
          border-right: none;
        }

        .report-page .summary-item .label {
          display: block;
          margin-bottom: 4px;
          font-size: 9px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #6c6d6b;
          font-weight: 700;
        }

        .report-page .summary-item .value {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 18px;
          font-weight: 800;
          color: #1f1f1f;
        }

        .report-page .summary-item .value .check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #dff5d4;
          border: 1px solid #7ad148;
          color: #2c7d11;
          font-size: 12px;
          font-weight: 800;
        }

        .report-page .module-block {
          display: flex;
          margin-top: 12px;
          border: 1px solid #d9d9d6;
          background: rgba(255,255,255,0.2);
        }

        .report-page .module-index {
          width: 70px;
          min-width: 70px;
          background: linear-gradient(180deg, #2f2f2d 0%, #1f1f1f 100%);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -1px;
        }

        .report-page .module-content {
          flex: 1;
          padding: 10px 14px;
          background: rgba(255,255,255,0.2);
        }

        .report-page .module-header-line {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          font-size: 12px;
          font-weight: 800;
          color: #1f1f1f;
        }

        .report-page .module-header-line .module-name {
          font-size: 14px;
        }

        .report-page .module-header-line .module-count {
          font-size: 11px;
          letter-spacing: 1px;
          color: #5f5f5d;
          text-transform: uppercase;
        }

        .report-page .cell-table {
          width: 100%;
          border-collapse: collapse;
        }

        .report-page .cell-table th,
        .report-page .cell-table td {
          border-bottom: 1px solid #e2e2df;
          padding: 6px 8px;
          text-align: left;
          font-size: 11px;
          color: #202020;
          vertical-align: middle;
        }

        .report-page .cell-table th {
          background: rgba(255,255,255,0.2);
          font-size: 9px;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: #666862;
          font-weight: 800;
        }

        .report-page .cell-table tr:last-child td {
          border-bottom: none;
        }

        .report-page .cell-grade {
          color: #2e8a2e;
          font-weight: 800;
        }

        .report-page .electronic-box {
          margin-top: 12px;
          border: 1px solid #d9d9d6;
          background: rgba(255,255,255,0.2);
          display: flex;
        }

        .report-page .electronic-box .electronic-index {
          width: 70px;
          min-width: 70px;
          background: linear-gradient(180deg, #2f2f2d 0%, #1f1f1f 100%);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          font-weight: 800;
        }

        .report-page .electronic-box .electronic-content {
          flex: 1;
          padding: 12px 14px;
        }

        .report-page .electronic-meta {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px 18px;
          margin-top: 8px;
        }

        .report-page .electronic-meta .meta-item {
          font-size: 11px;
          color: #43453f;
        }

        .report-page .electronic-meta .meta-item strong {
          display: block;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          color: #666862;
          margin-bottom: 4px;
        }

        .report-page .footer-strip {
          margin-top: 14px;
          background: linear-gradient(135deg, #292c2d 0%, #1f2123 100%);
          color: #f2f2f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 18px 16px 20px;
          min-height: 72px;
        }

        .report-page .scan-text {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          color: #f4f6f4;
          font-weight: 600;
        }

        .report-page .scan-icon {
          width: 18px;
          height: 18px;
          border: 1px solid #f8c437;
          border-radius: 4px;
          position: relative;
          background: rgba(248, 196, 55, 0.12);
        }

        .report-page .scan-icon::before,
        .report-page .scan-icon::after {
          content: "";
          position: absolute;
          inset: 4px;
          border: 1px solid rgba(248, 196, 55, 0.7);
        }

        .report-page .scan-icon::after {
          inset: 8px;
        }

        .report-page .qr-box {
          width: 70px;
          height: 70px;
          background: #f4f4f4;
          border: 1px solid #d9d9d6;
          position: relative;
          box-shadow: inset 0 0 0 6px #ffffff;
        }

        .report-page .qr-box::before,
        .report-page .qr-box::after {
          content: "";
          position: absolute;
          inset: 10px;
          border: 2px solid #1f1f1f;
          background:
            linear-gradient(#1f1f1f 0 0) 0 0 / 6px 6px no-repeat,
            linear-gradient(#1f1f1f 0 0) 0 100% / 6px 6px no-repeat,
            linear-gradient(#1f1f1f 0 0) 100% 0 / 6px 6px no-repeat,
            linear-gradient(#1f1f1f 0 0) 100% 100% / 6px 6px no-repeat,
            linear-gradient(#1f1f1f 0 0) 50% 50% / 10px 10px no-repeat;
        }

        .report-page .qr-box::after {
          inset: 22px;
        }
      `}</style>

      <div className="report-shell">
        <div id="battery-report-printable" className="report-page">
          <div className="topbar">
            <div className="brand">
              <span className="brand-mark">POWER<span className="green">2GO</span></span>
              <span className="brand-sub">Energy Storage Systems</span>
            </div>
            <div className="topbar-meta">
              <div><strong>Karachi</strong> | PAKISTAN</div>
              <div>+92 (345) 561-3478</div>
              <div>www.power2go.energy</div>
            </div>
          </div>

          <div className="report-body">
            <div className="report-header-row">
              <div>
                <span className="eyebrow">Mes Export / Traceability Document</span>
                <h2 className="report-title">Battery Pack Technical Report</h2>
              </div>
              <div className="pack-box">
                <span className="label">Pack Reference</span>
                <span className="value">{battery.serialNumber || 'N/A'}</span>
              </div>
            </div>

            <div className="summary-row">
              <div className="summary-item">
                <span className="label">Modules</span>
                <span className="value">{String(modules.length).padStart(2, '0')}</span>
              </div>
              <div className="summary-item">
                <span className="label">Total Cells</span>
                <span className="value">{String(totalCells).padStart(2, '0')}</span>
              </div>
              <div className="summary-item">
                <span className="label">Cell Name</span>
                <span className="value">{battery.productName || 'LF100LE'}</span>
              </div>
              <div className="summary-item">
                <span className="label">Export Date</span>
                <span className="value">{battery.createdAt ? new Date(battery.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}</span>
              </div>
              <div className="summary-item">
                <span className="label">Status</span>
                <span className="value"><span className="check">✓</span> {battery.status || 'Verified'}</span>
              </div>
            </div>

            {modules.map((module, index) => (
              <div className="module-block" key={module.id || index}>
                <div className="module-index">{String(index + 1).padStart(2, '0')}</div>
                <div className="module-content">
                  <div className="module-header-line">
                    <span className="module-name">Module {index + 1}  {module.serialNumber || '—'}</span>
                    <span className="module-count">Cells {module.cells?.length || 0}</span>
                  </div>
                  <table className="cell-table">
                    <thead>
                      <tr>
                        <th>Internal Serial</th>
                        <th>Cell Barcode</th>
                        <th>Cell Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(module.cells || []).map((cell, slotIndex) => (
                        <tr key={`${module.id || index}-${cell.id || slotIndex}`}>
                          <td>{cell.internalSerial || `P2G-C-LFP-250801-${String(slotIndex + 1).padStart(4, '0')}`}</td>
                          <td>{cell.supplierBarcode || '—'}</td>
                          <td className="cell-grade">{cell.productionGrade || cell.supplierGrade || 'A+'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            <div className="electronic-box">
              <div className="electronic-index">BMS</div>
              <div className="electronic-content">
                <div className="module-header-line">
                  <span className="module-name">Electronic</span>
                  <span className="module-count">Controller</span>
                </div>
                <div className="electronic-meta">
                  <div className="meta-item">
                    <strong>Model No</strong>
                    {controller?.model || '4717HSO399'}
                  </div>
                  <div className="meta-item">
                    <strong>Batch No</strong>
                    {controller?.serialNumber ? controller.serialNumber.slice(-4) : '2'}
                  </div>
                  <div className="meta-item">
                    <strong>Manufacturer</strong>
                    {controller?.manufacturer || 'Huawei'}
                  </div>
                </div>
              </div>
            </div>

            <div className="footer-strip">
              <div className="scan-text">
                <span className="scan-icon" aria-hidden="true" />
                Scan the QR code to download the digital PDF copy
              </div>
              <div className="qr-box" aria-label="QR code placeholder" />
            </div>
          </div>
        </div>
      </div>

      <div className="report-header-actions px-6 py-4 border-t border-slate-200 bg-white flex justify-end gap-2">
        <button
          type="button"
          onClick={downloadReport}
          className="px-4 py-2 border border-slate-200 bg-slate-50 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-100 flex items-center gap-1.5"
        >
          <Download className="w-4 h-4" />
          Save HTML
        </button>
        <button
          type="button"
          onClick={printReport}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
        >
          <Printer className="w-4 h-4" />
          Print / Save as PDF
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border border-slate-200 bg-white text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 flex items-center gap-1.5"
        >
          <X className="w-4 h-4" />
          Close
        </button>
      </div>
    </div>
  );
};
