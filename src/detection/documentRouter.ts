// ─── Document Router: Heuristic Document Classification ────────────────────
// Classifies documents BEFORE heavy ML to apply context-specific rulesets
// Supports: Invoice, Bank Statement, Medical Report, Tax Form, ID Card

export type DocumentType =
    | 'invoice'
    | 'bank_statement'
    | 'medical_report'
    | 'tax_return'
    | 'id_card_aadhaar'
    | 'id_card_pan'
    | 'health_report'
    | 'generic';

export interface DocumentClassification {
    primaryType: DocumentType;
    confidence: number;
    secondaryTypes: Array<{ type: DocumentType; confidence: number }>;
    detectedKeywords: string[];
}

// ─── Keyword Dictionaries ───────────────────────────────────────────────────

const INVOICE_KEYWORDS = [
    'invoice', 'bill', 'bill no', 'invoice no', 'inv no', 'invoice number',
    'bill to', 'ship to', 'customer', 'vendor', 'supplier', 'po number',
    'purchase order', 'payment terms', 'due date', 'subtotal', 'tax', 'gst',
    'igst', 'cgst', 'sgst', 'total amount', 'amount due', 'line item',
    'qty', 'quantity', 'price', 'item description', 'hsn', 'sac code',
];

const BANK_STATEMENT_KEYWORDS = [
    'bank statement', 'account statement', 'statement of account',
    'account number', 'account no', 'ifsc', 'ifsc code', 'branch',
    'transaction', 'transaction date', 'credit', 'debit', 'balance',
    'opening balance', 'closing balance', 'withdrawal', 'deposit',
    'cheque', 'check', 'rtgs', 'neft', 'imps', 'upi', 'iban', 'swift',
    'account holder', 'from date', 'to date', 'statement period',
];

const MEDICAL_KEYWORDS = [
    'patient', 'patient name', 'doctor', 'physician', 'hospital', 'clinic',
    'medical report', 'lab report', 'pathology', 'radiology', 'diagnosis',
    'prescription', 'medication', 'blood test', 'urine test', 'mri', 'ct scan',
    'x-ray', 'ultrasound', 'ecg', 'ekg', 'test results', 'normal range',
    'abnormal', 'positive', 'negative', 'hemoglobin', 'glucose', 'cholesterol',
    'blood pressure', 'heart rate', 'pulse', 'temperature', 'weight', 'bmi',
];

const TAX_KEYWORDS = [
    'income tax', 'tax return', 'itr', 'assessment year', 'financial year',
    'pan', 'permanent account number', 'tax deducted', 'tds', 'form 16',
    'form 26as', 'gross income', 'taxable income', 'deductions', 'exemptions',
    'tax payable', 'tax refund', 'acknowledgement', 'ack no', 'return filed',
    'tan', 'employer', 'salary', 'wages', 'capital gains',
];

const AADHAAR_KEYWORDS = [
    'aadhaar', 'aadhar', 'uid', 'unique identification', 'uidai',
    'government of india', 'bharatiya prachnya patr', 'enrollment no',
    'vid', 'virtual id', 'date of birth', 'dob', 'gender', 'male', 'female',
    'address', 'yob', 'year of birth',
];

const PAN_KEYWORDS = [
    'pan', 'permanent account number', 'income tax department',
    'father name', 'fathers name', 'date of birth', 'dob',
    'signature', 'photograph',
];

const HEALTH_REPORT_KEYWORDS = [
    'health report', 'medical certificate', 'fitness certificate',
    'blood group', 'allergies', 'past medical history', 'current medications',
    'vital signs', 'examination', 'clinical findings',
];

// ─── Scoring Functions ──────────────────────────────────────────────────────

function scoreDocumentType(text: string, keywords: string[]): {
    score: number;
    matched: string[];
} {
    const lowerText = text.toLowerCase();
    let score = 0;
    const matched: string[] = [];

    for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
            // Weight longer keywords higher (more specific)
            const weight = keyword.split(' ').length;
            score += weight;
            matched.push(keyword);
        }
    }

    return { score, matched };
}

/**
 * Classifies document type based on OCR text content using keyword matching.
 * Returns primary type and secondary candidates with confidence scores.
 */
export function classifyDocument(fullText: string): DocumentClassification {
    const invoiceResult = scoreDocumentType(fullText, INVOICE_KEYWORDS);
    const bankResult = scoreDocumentType(fullText, BANK_STATEMENT_KEYWORDS);
    const medicalResult = scoreDocumentType(fullText, MEDICAL_KEYWORDS);
    const taxResult = scoreDocumentType(fullText, TAX_KEYWORDS);
    const aadhaarResult = scoreDocumentType(fullText, AADHAAR_KEYWORDS);
    const panResult = scoreDocumentType(fullText, PAN_KEYWORDS);
    const healthResult = scoreDocumentType(fullText, HEALTH_REPORT_KEYWORDS);

    const candidates = [
        { type: 'invoice' as DocumentType, score: invoiceResult.score, matched: invoiceResult.matched },
        { type: 'bank_statement' as DocumentType, score: bankResult.score, matched: bankResult.matched },
        { type: 'medical_report' as DocumentType, score: medicalResult.score, matched: medicalResult.matched },
        { type: 'tax_return' as DocumentType, score: taxResult.score, matched: taxResult.matched },
        { type: 'id_card_aadhaar' as DocumentType, score: aadhaarResult.score, matched: aadhaarResult.matched },
        { type: 'id_card_pan' as DocumentType, score: panResult.score, matched: panResult.matched },
        { type: 'health_report' as DocumentType, score: healthResult.score, matched: healthResult.matched },
    ];

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    const topCandidate = candidates[0];
    const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);

    // If no clear winner, classify as generic
    if (topCandidate.score === 0) {
        return {
            primaryType: 'generic',
            confidence: 0,
            secondaryTypes: [],
            detectedKeywords: [],
        };
    }

    // Calculate confidence as ratio of top score to total
    const confidence = totalScore > 0 ? topCandidate.score / totalScore : 0;

    // Get secondary types (score > 0)
    const secondaryTypes = candidates
        .slice(1)
        .filter(c => c.score > 0)
        .map(c => ({
            type: c.type,
            confidence: totalScore > 0 ? c.score / totalScore : 0,
        }));

    return {
        primaryType: topCandidate.type,
        confidence: Math.min(confidence, 0.95), // Cap at 95%
        secondaryTypes,
        detectedKeywords: topCandidate.matched,
    };
}

/**
 * Returns context-specific ruleset configuration based on document type.
 * Defines which detection strategies to prioritize.
 */
export interface DetectionRuleset {
    prioritizeSpatialContext: boolean;   // Use spatial key-value detection
    enableTableDetection: boolean;       // Look for tabular structures
    aggressiveRegex: boolean;            // Apply strict regex patterns
    skipParagraphNER: boolean;           // Skip paragraph-style NER (for forms)
    confidenceBoost: number;              // Multiplier for this doc type
}

export function getRulesetForDocType(docType: DocumentType): DetectionRuleset {
    switch (docType) {
        case 'invoice':
            return {
                prioritizeSpatialContext: true,
                enableTableDetection: true,
                aggressiveRegex: true,
                skipParagraphNER: true,
                confidenceBoost: 1.2,
            };
        case 'bank_statement':
            return {
                prioritizeSpatialContext: true,
                enableTableDetection: true,
                aggressiveRegex: true,
                skipParagraphNER: true,
                confidenceBoost: 1.3,
            };
        case 'medical_report':
        case 'health_report':
            return {
                prioritizeSpatialContext: false,
                enableTableDetection: false,
                aggressiveRegex: false,
                skipParagraphNER: false,
                confidenceBoost: 1.0,
            };
        case 'tax_return':
            return {
                prioritizeSpatialContext: true,
                enableTableDetection: true,
                aggressiveRegex: true,
                skipParagraphNER: true,
                confidenceBoost: 1.15,
            };
        case 'id_card_aadhaar':
        case 'id_card_pan':
            return {
                prioritizeSpatialContext: true,
                enableTableDetection: false,
                aggressiveRegex: true,
                skipParagraphNER: true,
                confidenceBoost: 1.25,
            };
        default:
            return {
                prioritizeSpatialContext: false,
                enableTableDetection: false,
                aggressiveRegex: false,
                skipParagraphNER: false,
                confidenceBoost: 1.0,
            };
    }
}
