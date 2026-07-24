import React, { useState } from 'react';
import { isValidDataUrl } from '../src/utils/urlLoader';

interface UrlInputProps {
  onLoadUrl: (url: string) => void;
  /** Disables the submit button while a URL load is already in flight. */
  isLoading?: boolean;
  /**
   * Controlled draft URL. Lives in the parent so the typed text survives
   * this component unmounting (e.g. when a collapsible panel section closes).
   */
  value: string;
  onValueChange: (value: string) => void;
}

/** Input + button for loading a CSV/TSV file from a remote URL (issue #42). */
export const UrlInput: React.FC<UrlInputProps> = ({
  onLoadUrl,
  isLoading = false,
  value,
  onValueChange,
}) => {
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isLoading) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!isValidDataUrl(trimmed)) {
      setValidationError('Please enter a valid http(s) URL.');
      return;
    }
    setValidationError(null);
    onLoadUrl(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex space-x-2">
        <input
          type="text"
          value={value}
          onChange={e => {
            onValueChange(e.target.value);
            if (validationError) setValidationError(null);
          }}
          placeholder="https://example.com/data.csv"
          aria-label="CSV or TSV URL"
          className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-3 py-2 bg-brand-secondary text-white text-sm font-semibold rounded-lg shadow-md hover:bg-brand-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Loading…' : 'Load'}
        </button>
      </div>
      {validationError && (
        <p className="mt-1 text-xs text-red-600" role="alert">{validationError}</p>
      )}
    </form>
  );
};
