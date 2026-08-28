const fs = require('fs');

const newCode = `import React, { useState, useEffect, useRef } from 'react';
import { Camera, QrCode, Search, CheckCircle2, AlertTriangle, X, ArrowRight, Zap, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  title?: string;
  subtitle?: string;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  title = "Scan Component",
  subtitle = "One-Time Physical Identification & Digital Twin Linkage"
}) => {
  const { currentUser } = useAuth();
  const [barcode, setBarcode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setBarcode('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleScan = () => {
    const targetCode = barcode.trim();
    if (!targetCode) {
      setError('Please enter or scan a barcode/serial');
      return;
    }
    setError(null);
    onScan(targetCode);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4.5 bg-slate-900 text-white flex justify-between items-center">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">
                {title}
              </h3>
              <p className="text-[11px] text-slate-400">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Camera Scanner Simulation Frame */}
          <div className="relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 h-44 flex flex-col items-center justify-center text-center p-4">
            {/* Viewfinder reticle */}
            <div className="absolute inset-x-12 inset-y-6 border-2 border-dashed border-emerald-500/60 rounded-xl pointer-events-none flex items-center justify-center">
              <div className="w-full h-0.5 bg-emerald-400/80 shadow-[0_0_8px_rgba(99,102,241,0.8)] animate-pulse"></div>
            </div>
            
            <Camera className="w-8 h-8 text-emerald-400/80 mb-2" />
            <p className="text-xs font-semibold text-white">USB Laser Scanner & Camera Active</p>
            <p className="text-[11px] text-slate-400 max-w-xs mt-1">
              Position physical 2D DataMatrix or 1D barcode under laser scanner beam
            </p>
          </div>

          {/* Barcode Input Form */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              Barcode / Serial Number
            </label>
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. 04QCB6CJ28801JF9F0009042"
                className="w-full pl-10 pr-24 py-2.5 text-xs font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5" />
              <button
                onClick={handleScan}
                disabled={!barcode.trim()}
                className="absolute right-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg transition-colors flex items-center space-x-1"
              >
                <span>Identify</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3.5 bg-slate-100 border border-slate-300 rounded-xl text-black flex items-start space-x-2.5 text-xs animate-shake">
              <AlertTriangle className="w-4 h-4 text-slate-1000 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Identification Failed</p>
                <p className="text-[11px] mt-0.5">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
          <span>Operator: <strong className="text-slate-700">{currentUser?.name || 'Administrator'}</strong></span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-100 rounded-xl font-medium text-slate-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
`;

fs.writeFileSync('src/components/common/ScannerModal.tsx', newCode);
