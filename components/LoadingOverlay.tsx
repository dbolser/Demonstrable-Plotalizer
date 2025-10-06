import React from 'react';

interface LoadingOverlayProps {
  message: string;
  detail?: string;
  progress?: number;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message, detail, progress }) => {
  const clampedProgress = typeof progress === 'number'
    ? Math.max(0, Math.min(1, progress))
    : undefined;

  const percent = clampedProgress !== undefined
    ? Math.round(clampedProgress * 100)
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-80 max-w-full rounded-xl bg-white p-6 shadow-2xl">
        <div className="text-lg font-semibold text-brand-dark">{message}</div>
        {detail && (
          <p className="mt-2 text-sm text-gray-600">{detail}</p>
        )}
        {clampedProgress !== undefined && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-brand-secondary transition-all duration-200 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-2 text-xs font-medium text-gray-500">
              {percent}% complete
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
