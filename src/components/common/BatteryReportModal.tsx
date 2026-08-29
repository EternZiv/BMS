import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, X } from 'lucide-react';
import logoImg from '../../assets/logo.png';
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
  const qrPayload = battery.qrCode || `${battery.serialNumber}|BATTERY:${battery.id}`;
  const [qrImageUrl, setQrImageUrl] = useState('');

  useEffect(() => {
    void QRCode.toDataURL(qrPayload, {
      width: 180,
      margin: 1,
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    }).then((url) => setQrImageUrl(url)).catch(() => setQrImageUrl(''));
  }, [qrPayload]);

  const downloadReport = async () => {
    const printable = document.getElementById('battery-report-printable');
    if (!printable) return;

    let logoDataUrl = '';
    try {
      const logoDataUrlPromise = new Promise<string>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } else {
            resolve(logoImg);
          }
        };
        img.onerror = () => resolve(logoImg);
        img.src = logoImg;
      });
      logoDataUrl = await logoDataUrlPromise;
    } catch {
      logoDataUrl = logoImg;
    }

    let reportMarkup = printable.outerHTML;
    const logoImgElement = printable.querySelector('img[alt="Power2Go Logo"]') as HTMLImageElement;
    if (logoImgElement && logoDataUrl) {
      const oldSrc = logoImgElement.src;
      reportMarkup = reportMarkup.replace(new RegExp(`src="${oldSrc}"`, 'g'), `src="${logoDataUrl}"`)
        .replace(/src="[^"]*logo\.png[^"]*"/g, `src="${logoDataUrl}"`);
    }
    const exportStyles = `
      @page {
        size: A4 portrait;
        margin: 10mm 10mm 10mm 10mm;
      }
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: white;
        color: #111827;
        font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif;
      }
      body { 
        display: block;
        background: white;
        width: 210mm;
        margin: 0 auto;
      }
      * { box-sizing: border-box; }
      .report-page {
        width: 190mm;
        max-width: 190mm;
        margin: 0 auto;
        background: #f3f3f1;
        color: #1f1f1f;
        box-shadow: none;
        border: none;
        overflow: visible;
      }
      .topbar {
        position: relative;
        padding: 12px 16px 8px 16px;
        min-height: 60px;
        background: linear-gradient(135deg, #1f1f1f 0%, #1f1f1f 65%, #272b2b 100%);
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        overflow: hidden;
      }
      .topbar::after {
        content: "";
        position: absolute;
        right: -50px;
        top: 0;
        width: 300px;
        height: 100%;
        background: linear-gradient(135deg, #7CCB42 0%, #70C73D 35%, #4FA51D 100%);
        clip-path: polygon(20% 0, 100% 0, 100% 100%, 0% 100%);
      }
      .brand { position: relative; z-index: 1; margin-top: 4px; }
      .brand-logo {
        display: block;
        width: 120px;
        max-width: 100%;
        height: auto;
      }
      .brand-sub { display: block; margin-top: 2px; margin-left: 4px; font-size: 7px; letter-spacing: 1.5px; color: rgba(255,255,255,0.74); text-transform: uppercase; font-weight: 600; }
      .topbar-meta { position: relative; z-index: 1; margin-top: 6px; font-size: 8px; color: #fff; text-align: right; line-height: 1.3; font-weight: 600; }
      .report-body { background: #f3f3f1; padding: 6px 8px 6px; }
      .report-header-row { display: flex; align-items: flex-end; justify-content: space-between; padding: 6px 4px 6px; border-bottom: 1px solid #d8d8d5; gap: 8px; }
      .eyebrow { display: inline-block; font-size: 7px; letter-spacing: 1px; color: #6c6d6b; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; }
      .report-title { font-size: 14px; line-height: 1; margin: 0; font-weight: 800; color: #1f1f1f; }
      .pack-box { min-width: 180px; background: rgba(255,255,255,0.4); border: 1px solid #d8d8d5; border-left: 3px solid #7ad148; padding: 6px 10px; }
      .pack-box .label { display: block; font-size: 7px; letter-spacing: 1px; color: #7c7d78; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; }
      .pack-box .value { display: block; font-size: 12px; font-weight: 800; color: #1f1f1f; word-break: break-word; }
      .summary-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0; border-bottom: 1px solid #d8d8d5; background: rgba(255,255,255,0.28); }
      .summary-item { padding: 6px 8px; border-right: 1px solid #d8d8d5; }
      .summary-item:last-child { border-right: none; }
      .summary-item .label { display: block; margin-bottom: 2px; font-size: 7px; letter-spacing: 0.5px; text-transform: uppercase; color: #6c6d6b; font-weight: 700; }
      .summary-item .value { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800; color: #1f1f1f; }
      .summary-item .value .check { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; background: #dff5d4; border: 1px solid #7ad148; color: #2c7d11; font-size: 10px; font-weight: 800; }
      .module-block { display: flex; margin-top: 6px; border: 1px solid #d9d9d6; background: rgba(255,255,255,0.2); break-inside: avoid; page-break-inside: avoid; }
      .module-index { width: 45px; min-width: 45px; background: linear-gradient(180deg, #2f2f2d 0%, #1f1f1f 100%); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; letter-spacing: -1px; }
      .module-content { flex: 1; padding: 6px 8px; background: rgba(255,255,255,0.2); }
      .module-header-line { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 8px; font-weight: 800; color: #1f1f1f; }
      .module-header-line .module-name { font-size: 9px; }
      .module-header-line .module-count { font-size: 7px; letter-spacing: 0.5px; color: #5f5f5d; text-transform: uppercase; }
      .cell-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .cell-table th, .cell-table td { border-bottom: 1px solid #e2e2df; padding: 3px 4px; text-align: left; font-size: 8px; color: #202020; vertical-align: middle; word-break: break-word; overflow-wrap: anywhere; }
      .cell-table th { background: rgba(255,255,255,0.2); font-size: 7px; letter-spacing: 0.5px; text-transform: uppercase; color: #666862; font-weight: 800; }
      .cell-table tr:last-child td { border-bottom: none; }
      .cell-grade { color: #2e8a2e; font-weight: 800; }
      .electronic-box { margin-top: 6px; border: 1px solid #d9d9d6; background: rgba(255,255,255,0.2); display: flex; break-inside: avoid; page-break-inside: avoid; }
      .electronic-box .electronic-index { width: 45px; min-width: 45px; background: linear-gradient(180deg, #2f2f2d 0%, #1f1f1f 100%); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 800; }
      .electronic-box .electronic-content { flex: 1; padding: 6px 8px; }
      .electronic-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; margin-top: 4px; }
      .electronic-meta .meta-item { font-size: 8px; color: #43453f; }
      .electronic-meta .meta-item strong { display: block; font-size: 7px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; color: #666862; margin-bottom: 2px; }
      .footer-strip { margin-top: 6px; background: linear-gradient(135deg, #292c2d 0%, #1f2123 100%); color: #f2f2f0; display: flex; justify-content: space-between; align-items: center; padding: 8px 10px 6px 12px; min-height: 45px; break-inside: avoid; page-break-inside: avoid; }
      .scan-text { display: flex; align-items: center; gap: 6px; font-size: 8px; color: #f4f6f4; font-weight: 600; }
      .scan-icon { width: 14px; height: 14px; border: 1px solid #f8c437; border-radius: 3px; position: relative; background: rgba(248, 196, 55, 0.12); }
      .scan-icon::before, .scan-icon::after { content: ""; position: absolute; inset: 3px; border: 1px solid rgba(248, 196, 55, 0.7); }
      .scan-icon::after { inset: 6px; }
      .qr-box { width: 55px; height: 55px; background: #f4f4f4; border: 1px solid #d9d9d6; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: inset 0 0 0 4px #ffffff; }
      .qr-box img { width: 100%; height: 100%; object-fit: contain; display: block; }
    `;

    const exportHtml = `<!doctype html><html><head><meta charset="utf-8" /><title>${battery.serialNumber} Battery Report</title><style>${exportStyles}</style></head><body>${reportMarkup}</body></html>`;
    const blob = new Blob([exportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${battery.serialNumber}_report.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="battery-report-modal fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 10mm;
        }

        @media print {
          html, body {
            width: 210mm;
            height: 297mm;
            margin: 0;
            padding: 0;
            background: white;
          }

          body * {
            overflow: visible !important;
          }

          .battery-report-modal {
            position: static !important;
            inset: auto !important;
            width: 210mm !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            background: white !important;
            padding: 0 !important;
            display: block !important;
            margin: 0 !important;
          }

          .battery-report-modal .report-header-actions {
            display: none !important;
          }

          .battery-report-modal .report-shell {
            width: 210mm !important;
            max-width: 210mm !important;
            max-height: none !important;
            height: auto !important;
            overflow: visible !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            border-radius: 0 !important;
            background: white !important;
          }

          .report-page {
            width: 190mm !important;
            max-width: 190mm !important;
            min-height: auto !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            box-shadow: none !important;
            margin: 0 auto !important;
            break-inside: auto !important;
            page-break-inside: auto !important;
            background: white !important;
          }

          .report-page *,
          .report-page .module-block,
          .report-page .electronic-box,
          .report-page .footer-strip,
          .report-page .summary-row,
          .report-page .cell-table,
          .report-page .cell-table tr,
          .report-page .cell-table th,
          .report-page .cell-table td {
            overflow: visible !important;
            break-inside: auto !important;
            page-break-inside: auto !important;
          }

          .report-page .module-block,
          .report-page .electronic-box,
          .report-page .footer-strip {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          .report-page .cell-table {
            width: 100% !important;
            table-layout: fixed !important;
          }

          .report-page .cell-table thead {
            display: table-header-group !important;
          }

          .report-page .cell-table tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .report-page .cell-table td,
          .report-page .cell-table th {
            word-break: break-word !important;
            overflow-wrap: anywhere !important;
          }
        }

        .battery-report-modal {
          background: rgba(15, 23, 42, 0.7);
          font-family: 'Segoe UI', Arial, sans-serif;
        }

        .battery-report-modal .report-shell {
          width: min(960px, 100%);
          max-height: 92vh;
          overflow: auto;
          background: #ffffff;
          border-radius: 0;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25);
        }

        .report-page {
          width: 100%;
          max-width: 950px;
          min-height: auto;
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

        .report-page .brand-logo {
          display: block;
          width: 210px;
          max-width: 100%;
          height: auto;
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
          width: 78px;
          height: 78px;
          background: #f4f4f4;
          border: 1px solid #d9d9d6;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          box-shadow: inset 0 0 0 6px #ffffff;
        }

        .report-page .qr-box img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }
      `}</style>

      <div className="report-shell">
        <div id="battery-report-printable" className="report-page">
          <div className="topbar">
            <div className="brand">
              <img src={logoImg} alt="Power2Go Logo" className="brand-logo" />
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
              <div className="qr-box" aria-label="Battery QR code">
                {qrImageUrl ? <img src={qrImageUrl} alt="Battery QR code" /> : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="report-header-actions px-6 py-4 border-t border-slate-200 bg-white flex justify-end gap-2">
        <button
          type="button"
          onClick={downloadReport}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
        >
          <Download className="w-4 h-4" />
          Export Reports
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
