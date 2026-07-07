import React, { useId, useState } from 'react';

interface PanelSectionProps {
  title: string;
  /** Whether the section starts expanded. Open/closed state is local. */
  defaultOpen?: boolean;
  /** Short status hint shown on the header only while collapsed (e.g. "3 hidden"). */
  hint?: string | null;
  /** Always-visible header adornment (e.g. an active-count badge). */
  badge?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}

/**
 * A collapsible control-panel section with a keyboard-accessible header
 * button. Children are unmounted while collapsed; any state that must
 * survive collapse should live in the parent (as ControlPanel's does).
 */
export const PanelSection: React.FC<PanelSectionProps> = ({
  title,
  defaultOpen = false,
  hint,
  badge,
  testId,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  // Stable ids so assistive tech can associate the header button with the
  // content region (aria-controls) and name the section landmark
  // (aria-labelledby). useId avoids collisions between same-titled sections.
  const id = useId();
  const headerId = `${id}-header`;
  const contentId = `${id}-content`;

  return (
    <section data-testid={testId} aria-labelledby={headerId}>
      <button
        type="button"
        id={headerId}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full flex items-center justify-between text-left border-b pb-2 mb-3 focus:outline-none focus:ring-2 focus:ring-brand-secondary rounded-sm"
      >
        <span className="text-lg font-bold text-brand-dark flex items-center min-w-0">
          <span aria-hidden="true" className="mr-2 text-sm text-gray-400 flex-shrink-0">
            {open ? '▾' : '▸'}
          </span>
          <span className="truncate">{title}</span>
          {badge}
        </span>
        {!open && hint && (
          <span className="text-xs text-gray-500 truncate max-w-[10rem] ml-2 flex-shrink-0">
            {hint}
          </span>
        )}
      </button>
      {/* The region element stays mounted so aria-controls always resolves;
          children themselves are still unmounted while collapsed. */}
      <div id={contentId}>{open && children}</div>
    </section>
  );
};
