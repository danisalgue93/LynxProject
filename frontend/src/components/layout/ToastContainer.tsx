import React from 'react';
import { X, CheckCircle2, AlertCircle, Info, Loader } from 'lucide-react';
import { useToast } from '@/src/context/ToastContext';

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-3 z-[9999] max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-start gap-3 bg-[#0D0D0E] border border-[#27272A] rounded-lg p-4 shadow-lg animate-in fade-in slide-in-from-right-4 duration-300"
        >
          <div className="flex-shrink-0 mt-0.5">
            {toast.type === 'success' && (
              <CheckCircle2 className="w-5 h-5 text-[#00FFD1]" />
            )}
            {toast.type === 'error' && (
              <AlertCircle className="w-5 h-5 text-[#FF3D00]" />
            )}
            {toast.type === 'info' && (
              <Info className="w-5 h-5 text-[#3B82F6]" />
            )}
            {toast.type === 'pending' && (
              <Loader className="w-5 h-5 text-[#A1A1AA] animate-spin" />
            )}
          </div>

          <div className="flex-1">
            <p className="text-sm text-[#E5E7EB]">{toast.message}</p>
            {toast.url && (
              <a
                href={toast.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#00FFD1] hover:text-[#00E5BC] underline mt-2 inline-block transition-colors"
              >
                View on Explorer →
              </a>
            )}
          </div>

          <button
            type="button"
            aria-label="Close notification"
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 text-[#71717A] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
