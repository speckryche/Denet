import React, { useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export interface UploadZoneResult {
  processed: number;
  inserted: number;
  updated: number;
}

/**
 * State of the REAL import, owned by the parent. The zone's own progress bar
 * only covers reading the file; once it finishes, the card renders this.
 */
export type UploadOutcome =
  | { status: 'idle' }
  | { status: 'importing' }
  | { status: 'awaiting' }
  | { status: 'done'; result: UploadZoneResult }
  | { status: 'error'; message: string };

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  outcome?: UploadOutcome;
}

export function UploadZone({ onFileSelect, outcome = { status: 'importing' } }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'text/csv') {
      handleFile(droppedFile);
    } else {
      setUploadStatus('error');
    }
  }, []);

  const handleFile = (selectedFile: File) => {
    setFile(selectedFile);
    setUploadStatus('uploading');
    
    // Simulate upload
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += 10;
      setProgress(currentProgress);
      if (currentProgress >= 100) {
        clearInterval(interval);
        setUploadStatus('success');
        onFileSelect(selectedFile);
      }
    }, 200);
  };

  const resetUpload = () => {
    setFile(null);
    setUploadStatus('idle');
    setProgress(0);
  };

  return (
    <div
      className={cn(
        "relative w-full h-64 rounded-xl border-2 border-dashed transition-all duration-200 ease-in-out flex flex-col items-center justify-center p-6",
        isDragging 
          ? "border-primary bg-primary/5 shadow-[0_0_30px_rgba(0,102,255,0.15)]" 
          : "border-white/10 hover:border-white/20 bg-card/50",
        uploadStatus === 'error' && "border-red-500/50 bg-red-500/5"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {uploadStatus === 'idle' && (
        <>
          <div className={cn(
            "w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4 transition-transform duration-200",
            isDragging && "scale-110 text-primary"
          )}>
            <Upload className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-display font-bold text-foreground mb-2">
            Upload Sales CSV
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-xs mb-6">
            Drag and drop your sales data here, or click to browse files
          </p>
          <Button 
            variant="outline" 
            className="border-primary/20 hover:bg-primary/10 hover:text-primary"
            onClick={() => document.getElementById('file-upload')?.click()}
          >
            Browse Files
          </Button>
          <input 
            id="file-upload"
            type="file" 
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </>
      )}

      {uploadStatus === 'uploading' && (
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {file?.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {(file?.size || 0) / 1024 > 1024 
                  ? `${((file?.size || 0) / 1024 / 1024).toFixed(2)} MB`
                  : `${((file?.size || 0) / 1024).toFixed(2)} KB`}
              </p>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-center text-muted-foreground font-mono">
            PROCESSING... {progress}%
          </p>
        </div>
      )}

      {uploadStatus === 'success' && (
        <div className="text-center">
          {outcome.status === 'done' ? (
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-500" />
            </div>
          ) : outcome.status === 'error' ? (
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-500" />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          )}
          <h3 className="text-lg font-display font-bold text-foreground mb-2">
            {outcome.status === 'done'
              ? 'Upload Complete'
              : outcome.status === 'error'
                ? 'Import Failed'
                : outcome.status === 'awaiting'
                  ? 'Confirm Platform Conversion'
                  : 'Importing…'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {file?.name}
          </p>
          {outcome.status === 'done' ? (
            <dl className="mt-3 mb-6 flex items-center justify-center gap-6 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">New</dt>
                <dd className="font-semibold tabular-nums text-foreground">{outcome.result.inserted.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Updated</dt>
                <dd className="font-semibold tabular-nums text-foreground">{outcome.result.updated.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total</dt>
                <dd className="font-semibold tabular-nums text-foreground">{outcome.result.processed.toLocaleString()}</dd>
              </div>
            </dl>
          ) : outcome.status === 'error' ? (
            <p className="mt-2 mb-6 max-w-sm mx-auto text-sm text-red-700 dark:text-red-300 break-words">
              {outcome.message}
            </p>
          ) : outcome.status === 'awaiting' ? (
            <p className="mt-1 mb-6 text-sm text-muted-foreground">Waiting for your confirmation in the dialog.</p>
          ) : (
            <p className="mt-1 mb-6 text-sm text-muted-foreground">Writing records to the database…</p>
          )}
          {(outcome.status === 'done' || outcome.status === 'error') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetUpload}
              className="text-muted-foreground hover:text-foreground"
            >
              Upload Another
            </Button>
          )}
        </div>
      )}

      {uploadStatus === 'error' && (
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h3 className="text-lg font-display font-bold text-foreground mb-2">
            Upload Failed
          </h3>
          <p className="text-sm text-muted-foreground mb-6">
            Please upload a valid CSV file
          </p>
          <Button 
            variant="outline" 
            onClick={resetUpload}
            className="border-red-500/20 hover:bg-red-500/10 hover:text-red-500"
          >
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
