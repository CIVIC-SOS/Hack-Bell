import React, { useState, useCallback } from 'react';
import { SecureUploader } from './SecureUploader';
import { DocTypeSelector } from './DocTypeSelector';
import type { EvidenceLog, PIIType } from '../types';

// ─── Public API Types ───────────────────────────────────────────────────────

export interface SecureRedactProps {
  /**
   * Gemini API key for AI-powered PII detection.
   * Get one at https://aistudio.google.com/apikey
   */
  apiKey: string;

  /**
   * Array of PII field types that the developer wants to KEEP VISIBLE.
   * Everything else detected as PII will be redacted.
   *
   * Valid types: 'NAME' | 'PHONE' | 'EMAIL' | 'ADDRESS' | 'AADHAAR' | 'PAN' |
   *              'CREDIT_CARD' | 'DOB' | 'MEDICAL' | 'ACCOUNT_NUMBER' | 'IFSC' |
   *              'INVOICE_NO' | 'GST'
   *
   * @example ['NAME', 'DOB'] — keeps only name and date of birth visible
   */
  requiredFields?: string[];

  /**
   * Called when redaction is complete.
   * @param maskedFile - The redacted document as a File object (ready to upload/download)
   * @param evidence   - Audit trail of what was detected and what actions were taken
   */
  onComplete: (maskedFile: File, evidence: EvidenceLog) => void;

  /**
   * Minimum confidence threshold (0-1) for PII detection.
   * Lower values catch more entities but may have false positives.
   * @default 0.5
   */
  confidenceThreshold?: number;

  /**
   * Maximum uploaded file size in MB.
   * @default 25
   */
  maxFileSizeMB?: number;

  /**
   * Accepted MIME types for file upload.
   * @default ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'application/pdf']
   */
  acceptedTypes?: string[];

  /**
   * Whether to show the document type selector UI.
   * When true, users can pick a document type and select which fields to keep.
   * When false, only the uploader is shown and `requiredFields` prop is used directly.
   * @default false
   */
  showDocTypeSelector?: boolean;

  /**
   * Custom CSS class name for the root container.
   */
  className?: string;
}

/**
 * SecureRedact — Drop-in React component for client-side PII detection & redaction.
 *
 * Upload a document (image or PDF), automatically detect sensitive information
 * using OCR + regex + NLP + Gemini AI, review detections, and download a
 * redacted version — all without sending the original document to any server.
 *
 * @example
 * ```tsx
 * import { SecureRedact } from 'secure-redact';
 * import 'secure-redact/style.css';
 *
 * function App() {
 *   return (
 *     <SecureRedact
 *       apiKey="your-gemini-api-key"
 *       requiredFields={['NAME', 'DOB']}
 *       onComplete={(maskedFile, evidence) => {
 *         console.log('Redacted:', maskedFile.name);
 *         console.log('Evidence:', evidence);
 *       }}
 *     />
 *   );
 * }
 * ```
 */
export const SecureRedact: React.FC<SecureRedactProps> = ({
  apiKey,
  requiredFields: requiredFieldsProp = [],
  onComplete,
  confidenceThreshold = 0.5,
  maxFileSizeMB = 25,
  acceptedTypes,
  showDocTypeSelector = false,
  className,
}) => {
  const [selectedDocType, setSelectedDocType] = useState<string | null>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);

  // Resolve which fields to use — either from the selector UI or from props
  const effectiveFields = showDocTypeSelector ? selectedFields : requiredFieldsProp;

  const handleUpload = useCallback(
    (maskedFile: File, evidenceBlob: string) => {
      const evidence: EvidenceLog = JSON.parse(evidenceBlob);
      onComplete(maskedFile, evidence);
    },
    [onComplete]
  );

  return (
    <div className={`su-root ${className ?? ''}`}>
      {showDocTypeSelector && (
        <DocTypeSelector
          selectedDocType={selectedDocType}
          selectedFields={selectedFields}
          onDocTypeChange={setSelectedDocType}
          onFieldsChange={setSelectedFields}
        />
      )}

      <SecureUploader
        apiKey={apiKey}
        requiredFields={effectiveFields}
        confidenceThreshold={confidenceThreshold}
        onUpload={handleUpload}
        maxFileSizeMB={maxFileSizeMB}
        acceptedTypes={acceptedTypes}
      />
    </div>
  );
};
