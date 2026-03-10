# Hack-Bell - Implementation Site

A Smart PII Detection and Redaction System that acts as a privacy filter during the document upload process on digital platforms.

> 🎉 **Now available as an npm package!** Install and use the core redaction component directly in your own React project — no server required.

[![npm version](https://img.shields.io/npm/v/secure-redact.svg)](https://www.npmjs.com/package/secure-redact)
[![license](https://img.shields.io/npm/l/secure-redact.svg)](./LICENSE)

---

## 📦 npm Package — `secure-redact`

The Hack-Bell detection and redaction engine is published on npm as **[secure-redact](https://www.npmjs.com/package/secure-redact)**. Any developer can drop it into their React application with a single install command.

### Install

```bash
npm install secure-redact
```

### Quick Start

```tsx
import { SecureRedact } from 'secure-redact';
import 'secure-redact/style.css';

function App() {
  const handleComplete = (maskedFile, evidence) => {
    // maskedFile: File — the redacted document ready to download / upload
    console.log('Redacted file:', maskedFile.name, maskedFile.size);

    // evidence: EvidenceLog — full audit trail of every detected entity
    console.log('Entities detected:', evidence.detectedEntities.length);

    // Download the redacted file
    const url = URL.createObjectURL(maskedFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = maskedFile.name;
    a.click();
  };

  return (
    <SecureRedact
      apiKey="your-gemini-api-key"
      onComplete={handleComplete}
    />
  );
}
```

The component automatically walks the user through five steps:

1. **Document Type selector** — Aadhaar Card, PAN Card, Health Report, Income Tax Return, Invoice, Bank Statement
2. **Field selection** — choose which fields to keep visible; everything else is redacted
3. **File upload** — PNG, JPEG, WebP, BMP, and PDF supported
4. **Review modal** — preview and toggle individual detections before redacting
5. **Output** — returns a redacted `File` + an `EvidenceLog`

---

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiKey` | `string` | *required* | Gemini API key for AI-powered detection |
| `onComplete` | `(file, evidence) => void` | *required* | Called when redaction is complete |
| `requiredFields` | `string[]` | `[]` | PII types to **keep** visible |
| `confidenceThreshold` | `number` | `0.5` | Minimum confidence (0–1) for a detection to be used |
| `maxFileSizeMB` | `number` | `25` | Maximum file size in MB |
| `showDocTypeSelector` | `boolean` | `true` | Show the built-in document type picker UI |
| `acceptedTypes` | `string[]` | Images + PDF | Accepted MIME types |
| `className` | `string` | — | Custom CSS class for the root container |

---

### Supported Document Types

| Document | Detectable Fields |
|----------|-------------------|
| 🪪 **Aadhaar Card** | Name, Address, DOB, Aadhaar Number, Phone, Gender, Photo, QR Code |
| 💳 **PAN Card** | Name, Father's Name, DOB, PAN Number, Photo, Signature |
| 🏥 **Health Report** | Patient Name, Age, DOB, Doctor, Hospital, Diagnosis, Medications, Test Results, Blood Group |
| 📊 **Income Tax Return** | Name, PAN, Address, Income, Tax Amount, Assessment Year, TAN, Employer |
| 🧾 **Invoice** | Company, Customer, Address, Invoice No, Date, Amount, GST, Line Items, Bank Details |
| 🏦 **Bank Statement** | Account Holder, Account No, IFSC, Address, Transactions, Balance, Bank Name, Branch, Date |

---

### How It Works

```
Document Upload
    ↓
Tesseract.js OCR (browser-side, no server)
    ↓
Multi-Layer PII Detection:
  ├── Layer 0: Regex + Checksums (Aadhaar, PAN, Credit Card, Phone)
  ├── Layer 1: NLP Heuristics (Names, Addresses, Medical terms)
  ├── Layer 2: Spatial Key-Value Mapping ("Name:" → "John Doe")
  └── Layer 3: Gemini AI semantic filter (edge cases)
    ↓
Confidence Fusion Engine (deduplication + layer priority)
    ↓
Interactive Review Modal
    ↓
Destructive Redaction (black rectangles over original pixels)
    ↓
Redacted File + Evidence Log returned to onComplete
```

---

### Evidence Log

```typescript
interface EvidenceLog {
  timestamp: string;           // ISO timestamp of the operation
  fileName: string;            // Original file name
  detectedEntities: Array<{
    type: PIIType;             // e.g. 'NAME', 'AADHAAR', 'PAN'
    confidence: number;        // 0–1 detection confidence
    action: 'masked' | 'kept_visible';
    userConfirmed: boolean;
  }>;
  requiredFields: string[];    // Fields the user chose to keep visible
}
```

---

### Requirements

- **React** ≥ 18.0.0
- **Bundler** — Vite is recommended. Webpack 5+ also works, but you must enable the [`asset/resource`](https://webpack.js.org/guides/asset-modules/) rule so that `new URL(..., import.meta.url)` worker syntax is resolved correctly.

---

## ✨ Features

- 🔒 **100% Client-Side** — documents never leave the browser
- 🤖 **AI-Powered** — Gemini 1.5 Flash for semantic PII detection
- 🧩 **Multi-Layer Detection** — Regex + NLP + Spatial Analysis + Gemini AI
- 📄 **PDF & Image Support** — PNG, JPEG, WebP, BMP, PDF
- 🎯 **Pixel-Perfect Redaction** — word-ID based mapping for exact bounding boxes
- 👁️ **Review UI** — interactive modal to review and toggle detections before redacting
- 📋 **Audit Trail** — evidence log of all detected entities and actions taken
- 🇮🇳 **Indian Documents** — built-in support for Aadhaar, PAN, GST, IFSC, and more

---

## 🔗 Links

- **npm package**: https://www.npmjs.com/package/secure-redact
- **Architecture docs**: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## License

MIT

