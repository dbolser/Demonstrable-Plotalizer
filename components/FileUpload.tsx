
import React, { useCallback, useRef } from 'react';
import { UploadIcon } from './icons';

interface FileUploadProps {
  onDataLoaded: (data: string, filename: string) => void;
}

// MIME types are unreliable for delimited text (TSVs often report an empty
// type), so acceptance is decided by extension. Parsing auto-detects the
// delimiter, so any of these route through the same pipeline.
export const isSupportedDataFile = (name: string): boolean =>
  /\.(csv|tsv|tab|txt)$/i.test(name);

export const FileUpload: React.FC<FileUploadProps> = ({ onDataLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') {
        onDataLoaded(text, file.name);
      }
    };
    reader.readAsText(file);
  }, [onDataLoaded]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      readFile(file);
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
    if (file && isSupportedDataFile(file.name)) {
      readFile(file);
    } else {
      alert("Please drop a valid CSV or TSV file (.csv, .tsv, .tab, .txt).");
    }
  }, [readFile]);

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
  };

  return (
    <div
      onClick={handleButtonClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept=".csv,.tsv,.tab,.txt"
      />
      <UploadIcon className="h-8 w-8 text-gray-400 mb-2" />
      <span className="text-sm font-medium text-gray-600">
        Click to upload or drag-and-drop CSV / TSV
      </span>
    </div>
  );
};
