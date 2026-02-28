import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { SecureUploaderProps, DetectedEntity, ProcessingStage } from '../types';
import { WorkerPool } from '../workers/WorkerPool';
import { parseFile, isValidFileType, formatFileSize } from '../processing/fileParser';
import { processImage, redactImageRegions, canvasToFile } from '../processing/imageProcessor';
import { redactPDF, pdfBytesToFile } from '../processing/pdfProcessor';
import { renderPDFPageToImage } from '../processing/pdfRenderer';
import { runDetectionPipeline } from '../detection/pipeline';
import { ProgressIndicator } from './ProgressIndicator';
import { ReviewModal } from './ReviewModal';

const DEFAULT_MAX_SIZE_MB = 25;
const DEFAULT_CONFIDENCE = 0.5;

export const SecureUploader: React.FC<SecureUploaderProps> = ({
    requiredFields = [],
    confidenceThreshold = DEFAULT_CONFIDENCE,
    onUpload,
    maxFileSizeMB = DEFAULT_MAX_SIZE_MB,
    acceptedTypes,
    apiKey,
}) => {
    // Resolve Gemini API key: prop > env var
    const resolvedApiKey = apiKey ?? (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_GEMINI_API_KEY ?? '' : '');
    const [stage, setStage] = useState<ProcessingStage>('idle');
    const [progress, setProgress] = useState(0);
    const [message, setMessage] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [entities, setEntities] = useState<DetectedEntity[]>([]);
    const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
    const [currentFile, setCurrentFile] = useState<File | null>(null);
    const [currentBuffer, setCurrentBuffer] = useState<ArrayBuffer | null>(null);
    const [redactedPreviewUrl, setRedactedPreviewUrl] = useState<string | null>(null);
    const [redactedFile, setRedactedFile] = useState<File | null>(null);

    const workerPoolRef = useRef<WorkerPool | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pdfDimRef = useRef<{ width: number; height: number }>({ width: 612, height: 792 });

    // Clean up workers on unmount
    useEffect(() => {
        return () => {
            workerPoolRef.current?.terminate();
        };
    }, []);

    const getWorkerPool = useCallback((): WorkerPool => {
        if (!workerPoolRef.current) {
            workerPoolRef.current = new WorkerPool();
            workerPoolRef.current.setProgressCallback((p, msg) => {
                setProgress(p);
                setMessage(msg);
            });
        }
        return workerPoolRef.current;
    }, []);

    const processFile = useCallback(async (file: File) => {
        setError(null);
        setStage('loading');
        setMessage('Preparing document...');
        setProgress(0);
        setCurrentFile(file);

        try {
            // Validate file
            if (!isValidFileType(file)) {
                throw new Error('Unsupported file type. Please upload an image or PDF.');
            }

            if (file.size > maxFileSizeMB * 1024 * 1024) {
                throw new Error(`File too large. Maximum size is ${maxFileSizeMB}MB.`);
            }

            const parsed = await parseFile(file);
            setCurrentBuffer(parsed.buffer);

            // Stage 2: OCR
            setStage('ocr');
            setMessage('Extracting text from document...');
            const pool = getWorkerPool();

            let imageDataUrl: string | null = null;

            let ocrBuffer = parsed.buffer;
            let ocrMimeType = parsed.mimeType;

            if (parsed.type === 'image') {
                const { canvas } = await processImage(parsed.buffer, parsed.mimeType);
                imageDataUrl = canvas.toDataURL();
            } else {
                // Render PDF page to a PNG image — Tesseract cannot read PDFs directly
                setMessage('Rendering PDF page for OCR...');
                const { imageBuffer, width, height, canvas } = await renderPDFPageToImage(parsed.buffer, 0);
                ocrBuffer = imageBuffer;
                ocrMimeType = 'image/png';
                imageDataUrl = canvas.toDataURL();
                pdfDimRef.current = { width, height };
            }

            const { words, fullText } = await pool.runOCR(ocrBuffer, ocrMimeType, 0);

            if (words.length === 0 && fullText.trim().length === 0) {
                setStage('review');
                setMessage('No text detected in document.');
                setEntities([]);
                setPreviewDataUrl(imageDataUrl);
                return;
            }

            // Stage 3: Detection
            setStage('detection');
            setMessage('Analyzing for sensitive information...');

            const detected = await runDetectionPipeline(
                fullText,
                words,
                resolvedApiKey,
                confidenceThreshold,
                requiredFields,
                0,
                (msg) => setMessage(msg)
            );

            setEntities(detected);
            setPreviewDataUrl(imageDataUrl);
            setStage('review');
            setMessage(`Found ${detected.length} item(s). Please review before proceeding.`);
        } catch (err) {
            setStage('error');
            setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
            setMessage('');
        }
    }, [confidenceThreshold, requiredFields, maxFileSizeMB, getWorkerPool]);

    const handleConfirmRedaction = useCallback(async (confirmedEntities: DetectedEntity[]) => {
        if (!currentFile || !currentBuffer) return;

        setStage('redacting');
        setMessage('Applying redaction...');

        try {
            const parsed = await parseFile(currentFile);
            let redactedFile: File;

            let previewUrl: string | null = null;

            if (parsed.type === 'image') {
                const { canvas } = await processImage(parsed.buffer, parsed.mimeType);
                redactImageRegions(canvas, confirmedEntities);
                previewUrl = canvas.toDataURL();
                redactedFile = await canvasToFile(
                    canvas,
                    `redacted_${currentFile.name}`,
                    parsed.mimeType
                );
            } else {
                // PDF redaction — use the dimensions from the pre-rendered OCR image
                const imageWidth = pdfDimRef.current.width;
                const imageHeight = pdfDimRef.current.height;
                const redactedBytes = await redactPDF(
                    parsed.buffer,
                    confirmedEntities,
                    imageWidth,
                    imageHeight
                );
                redactedFile = pdfBytesToFile(redactedBytes, `redacted_${currentFile.name}`);
                // Render first page of redacted PDF for preview
                try {
                    const { canvas } = await renderPDFPageToImage(
                        redactedBytes.buffer.slice(redactedBytes.byteOffset, redactedBytes.byteOffset + redactedBytes.byteLength) as ArrayBuffer,
                        0
                    );
                    previewUrl = canvas.toDataURL();
                } catch {
                    previewUrl = null;
                }
            }

            // Generate evidence log
            const evidence = {
                timestamp: new Date().toISOString(),
                fileName: currentFile.name,
                detectedEntities: confirmedEntities.map(e => ({
                    type: e.type,
                    confidence: e.confidence,
                    action: e.masked ? 'masked' as const : 'kept_visible' as const,
                    userConfirmed: true,
                })),
                requiredFields,
            };

            setRedactedPreviewUrl(previewUrl);
            setRedactedFile(redactedFile);
            setStage('complete');
            setMessage('Redaction complete.');
            onUpload(redactedFile, JSON.stringify(evidence, null, 2));
        } catch (err) {
            setStage('error');
            setError(err instanceof Error ? err.message : 'Redaction failed.');
        }
    }, [currentFile, currentBuffer, requiredFields, onUpload]);

    const resetState = useCallback(() => {
        setStage('idle');
        setProgress(0);
        setMessage('');
        setError(null);
        setEntities([]);
        setPreviewDataUrl(null);
        setRedactedPreviewUrl(null);
        setRedactedFile(null);
        setCurrentFile(null);
        setCurrentBuffer(null);
        setIsDragOver(false);
    }, []);

    // ─── Drag & Drop Handlers ──────────────────────────────────────────────

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const file = e.dataTransfer.files[0];
        if (file) processFile(file);
    }, [processFile]);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) processFile(file);
    }, [processFile]);

    const handleClick = useCallback(() => {
        if (stage === 'idle') {
            fileInputRef.current?.click();
        }
    }, [stage]);

    // ─── Render ─────────────────────────────────────────────────────────────

    const isProcessing = ['loading', 'ocr', 'detection', 'redacting'].includes(stage);

    const acceptString = acceptedTypes?.join(',') ?? 'image/png,image/jpeg,image/webp,image/bmp,application/pdf';

    return (
        <div className="su-root">
            {/* Drop Zone */}
            <div
                className={`su-dropzone ${isDragOver ? 'su-dropzone--active' : ''} ${isProcessing ? 'su-dropzone--processing' : ''} ${stage === 'complete' ? 'su-dropzone--complete' : ''} ${stage === 'error' ? 'su-dropzone--error' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleClick}
                role="button"
                tabIndex={0}
                aria-label="Upload document for PII detection"
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    className="su-file-input"
                    accept={acceptString}
                    onChange={handleFileInput}
                />

                {stage === 'idle' && (
                    <div className="su-dropzone-content">
                        <div className="su-dropzone-icon">
                            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M20 5L20 25M20 5L13 12M20 5L27 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M6 25V31C6 33.2091 7.79086 35 10 35H30C32.2091 35 34 33.2091 34 31V25" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                        <p className="su-dropzone-title">Drop your document here</p>
                        <p className="su-dropzone-hint">or click to browse</p>
                        <p className="su-dropzone-formats">
                            Supports PNG, JPEG, WebP, BMP, PDF (max {maxFileSizeMB}MB)
                        </p>
                    </div>
                )}

                {isProcessing && (
                    <div className="su-dropzone-processing">
                        <ProgressIndicator stage={stage} progress={progress} message={message} />
                    </div>
                )}

                {stage === 'complete' && (
                    <div className="su-dropzone-content su-dropzone-content--complete">
                        <div className="su-dropzone-icon su-dropzone-icon--success">
                            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2.5" />
                                <path d="M13 20L18 25L27 15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                        <p className="su-dropzone-title">Redaction Complete</p>
                        <p className="su-dropzone-hint">Document has been securely processed</p>
                    </div>
                )}

                {stage === 'error' && (
                    <div className="su-dropzone-content su-dropzone-content--error">
                        <div className="su-dropzone-icon su-dropzone-icon--error">
                            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2.5" />
                                <path d="M15 15L25 25M25 15L15 25" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                            </svg>
                        </div>
                        <p className="su-dropzone-title">Processing Failed</p>
                        <p className="su-dropzone-hint">{error}</p>
                        <button className="su-btn su-btn--secondary su-btn--sm" onClick={(e) => { e.stopPropagation(); resetState(); }}>
                            Try Again
                        </button>
                    </div>
                )}

                {currentFile && stage !== 'idle' && stage !== 'error' && stage !== 'complete' && (
                    <div className="su-file-badge">
                        <span className="su-file-badge-name">{currentFile.name}</span>
                        <span className="su-file-badge-size">{formatFileSize(currentFile.size)}</span>
                    </div>
                )}
            </div>

            {/* ── Redacted Result Panel ── */}
            {stage === 'complete' && redactedFile && (
                <div className="su-result-panel">
                    <div className="su-result-header">
                        <div className="su-result-title-row">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="su-result-check">
                                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M6.5 10L9 12.5L13.5 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="su-result-title">Redacted Document</span>
                        </div>
                        <span className="su-result-filename">{redactedFile.name}</span>
                    </div>

                    {redactedPreviewUrl && (
                        <div className="su-result-preview">
                            <img
                                src={redactedPreviewUrl}
                                alt="Redacted document preview"
                                className="su-result-img"
                            />
                        </div>
                    )}

                    <div className="su-result-actions">
                        <a
                            href={URL.createObjectURL(redactedFile)}
                            download={redactedFile.name}
                            className="su-btn su-btn--primary"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: 6 }}>
                                <path d="M8 2v8M8 10L5 7M8 10l3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M2 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            </svg>
                            Download
                        </a>
                        <button className="su-btn su-btn--secondary" onClick={resetState}>
                            Process Another Document
                        </button>
                    </div>
                </div>
            )}

            {/* Review Modal */}
            {stage === 'review' && (
                <ReviewModal
                    entities={entities}
                    imageDataUrl={previewDataUrl}
                    fileName={currentFile?.name ?? 'document'}
                    onConfirm={handleConfirmRedaction}
                    onCancel={resetState}
                    requiredFields={requiredFields}
                    confidenceThreshold={confidenceThreshold}
                />
            )}
        </div>
    );
};
