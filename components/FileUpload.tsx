
import React, { useCallback, useRef } from 'react';
import { UploadIcon } from './icons';

interface FileUploadProps {
  onDataLoaded: (data: string, filename: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onDataLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === 'string') {
          onDataLoaded(text, file.name);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
     if (file && file.type === "text/csv") {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result;
            if (typeof text === 'string') {
                onDataLoaded(text, file.name);
            }
        };
        reader.readAsText(file);
    } else {
        alert("Please drop a valid CSV file.");
    }
  }, [onDataLoaded]);

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
        accept=".csv"
      />
      <UploadIcon className="h-8 w-8 text-gray-400 mb-2" />
      <span className="text-sm font-medium text-gray-600">
        Click to upload or drag-and-drop CSV
      </span>
    </div>
  );
};
