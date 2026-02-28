// ─── secure-redact — Library Entry Point ────────────────────────────────────
// This is the main entry point for npm consumers.
//
// Usage:
//   import { SecureRedact } from 'secure-redact';
//   import 'secure-redact/style.css';

// Import styles so Vite extracts them to dist/style.css
import './styles/secure-redact.css';

// ─── Primary Component ──────────────────────────────────────────────────────
export { SecureRedact } from './components/SecureRedact';
export type { SecureRedactProps } from './components/SecureRedact';

// ─── Lower-level component (advanced usage) ─────────────────────────────────
export { SecureUploader } from './components/SecureUploader';
export { DocTypeSelector } from './components/DocTypeSelector';

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  SecureUploaderProps,
  PIIType,
  DetectedEntity,
  BoundingBox,
  EvidenceLog,
  ProcessingStage,
  ProcessingState,
} from './types';

// ─── Document Config (for custom doc type setups) ───────────────────────────
export { DOCUMENT_TYPES } from './config/documentTypes';
export type { DocTypeConfig, DocField } from './config/documentTypes';
