# secure-redact

> Client-side PII detection and redaction React component. Upload documents, automatically detect sensitive information using OCR + AI, review detections, and download redacted copies — **all without sending originals to any server**.

[![npm version](https://img.shields.io/npm/v/secure-redact.svg)](https://www.npmjs.com/package/secure-redact)
[![license](https://img.shields.io/npm/l/secure-redact.svg)](https://github.com/your-repo/secure-redact/blob/main/LICENSE)

## Features

- 🔒 **100% Client-Side** — Documents never leave the browser
- 🤖 **AI-Powered** — Tensorflow for semantic PII detection with pixel-perfect accuracy
- 📝 **Multi-Layer Detection** — Regex + NLP + Spatial Analysis + tensorflow AI
- 📄 **PDF & Image Support** — PNG, JPEG, WebP, BMP, and PDF documents
- 🎯 **Pixel-Perfect Redaction** — Word-ID based mapping for exact bounding boxes
- 👁️ **Review UI** — Interactive modal to review and toggle detections before redacting
- 📋 **Audit Trail** — Evidence log of all detected entities and actions taken
- 🇮🇳 **Indian Documents** — Built-in support for Aadhaar, PAN, GST, IFSC, etc.

## Install

```bash
npm install secure-redact
```

## Quick Start

```tsx
import { SecureRedact } from 'secure-redact';
import 'secure-redact/style.css';

function App() {
  return (
    <SecureRedact
      apiKey="your-tensorflow-api-key"
      requiredFields={['NAME', 'DOB']}
      onComplete={(maskedFile, evidence) => {
        // maskedFile: File — the redacted document ready to download/upload
        console.log('Redacted file:', maskedFile.name, maskedFile.size);

        // evidence: EvidenceLog — audit trail of detections
        console.log('Entities detected:', evidence.detectedEntities.length);
      }}
    />
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiKey` | `string` | *required* | Tensorflow Model  |
| `requiredFields` | `string[]` | `[]` | PII types to KEEP visible (everything else is redacted) |
| `onComplete` | `(file: File, evidence: EvidenceLog) => void` | *required* | Called when redaction is complete |
| `confidenceThreshold` | `number` | `0.5` | Minimum confidence (0-1) for PII detection |
| `maxFileSizeMB` | `number` | `25` | Maximum file size in MB |
| `acceptedTypes` | `string[]` | Images + PDF | Accepted MIME types |
| `showDocTypeSelector` | `boolean` | `false` | Show document type picker UI |
| `className` | `string` | — | Custom CSS class for root container |

## Available PII Types

Use these values in the `requiredFields` array:

| Type | Description |
|------|-------------|
| `NAME` | Person/organization names |
| `PHONE` | Phone/mobile numbers |
| `EMAIL` | Email addresses |
| `ADDRESS` | Physical addresses |
| `AADHAAR` | Aadhaar (UID) numbers |
| `PAN` | PAN card numbers |
| `CREDIT_CARD` | Credit/debit card numbers |
| `DOB` | Dates of birth |
| `MEDICAL` | Medical information |
| `ACCOUNT_NUMBER` | Bank account numbers |
| `IFSC` | IFSC codes |
| `INVOICE_NO` | Invoice numbers |
| `GST` | GST/GSTIN numbers |

## Examples

### Redact everything (maximum privacy)

```tsx
<SecureRedact
  apiKey="your-key"
  requiredFields={[]}  // nothing kept visible
  onComplete={(file) => downloadFile(file)}
/>
```

### Keep only name and address visible

```tsx
<SecureRedact
  apiKey="your-key"
  requiredFields={['NAME', 'ADDRESS']}
  onComplete={(file, evidence) => {
    console.log(`${evidence.detectedEntities.length} entities processed`);
  }}
/>
```

### With document type selector UI

```tsx
<SecureRedact
  apiKey="Ten"
  showDocTypeSelector={true}
  onComplete={(file) => uploadToServer(file)}
/>
```

### Using the lower-level component

```tsx
import { SecureUploader } from 'secure-redact';
import 'secure-redact/style.css';

<SecureUploader
  apiKey="your-key"
  requiredFields={['NAME']}
  confidenceThreshold={0.7}
  onUpload={(maskedFile, evidenceJson) => {
    const evidence = JSON.parse(evidenceJson);
    // ...
  }}
/>
```

## How It Works

```
Document Upload
    ↓
Tesseract.js OCR (browser-side)
    ↓
Multi-Layer PII Detection:
  ├── Layer 0: Regex + Checksums (Aadhaar, PAN, CC, Phone)
  ├── Layer 1: NLP Heuristics (Names, Addresses, Medical)
  ├── Layer 2: Spatial Key-Value Mapping ("Name:" → "John Doe")
  └── Layer 4: tensorflow AI Word-ID Detection (pixel-perfect)
    ↓
Interactive Review Modal
    ↓
Destructive Redaction (black rectangles)
    ↓
Redacted File + Evidence Log
```

## Evidence Log

The `evidence` object returned in `onComplete` has this structure:

```typescript
interface EvidenceLog {
  timestamp: string;           // ISO timestamp
  fileName: string;            // Original file name
  detectedEntities: Array<{
    type: PIIType;             // e.g., 'NAME', 'AADHAAR'
    confidence: number;        // 0-1 detection confidence
    action: 'masked' | 'kept_visible';
    userConfirmed: boolean;
  }>;
  requiredFields: string[];    // Fields that were kept visible
}
```

## Requirements

- **React** ≥ 18.0.0
- **tensorflow Models** 
- **Vite** (recommended) — Workers use `new URL(..., import.meta.url)` syntax

## License

MIT
