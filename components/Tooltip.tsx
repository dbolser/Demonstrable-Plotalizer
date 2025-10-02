
import React from 'react';

interface TooltipProps {
  visible: boolean;
  content: string;
  x: number;
  y: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ visible, content, x, y }) => {
  if (!visible) {
    return null;
  }

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${x + 15}px`,
    top: `${y + 15}px`,
    pointerEvents: 'none',
  };

  return (
    <div
      style={style}
      className="bg-white text-gray-800 text-sm font-semibold px-2 py-1 rounded-md shadow-lg border border-gray-200"
    >
      {content}
    </div>
  );
};
