// ─── Spatial Context Mapper: The Game Changer ───────────────────────────────
// Groups OCR words into Lines and Blocks using bounding box spatial relationships
// Detects Key-Value pairs (e.g., "Name:" → "John Doe") with high confidence
// Implements table structure detection for invoices and bank statements

import type { OCRWord, DetectedEntity, PIIType } from '../types';

export interface TextLine {
    words: OCRWord[];
    y: number;          // Average Y position
    x: number;          // Leftmost X
    width: number;      // Span width
    height: number;     // Line height
    text: string;       // Concatenated text
}

export interface TextBlock {
    lines: TextLine[];
    bbox: { x: number; y: number; w: number; h: number; pageIndex: number };
    text: string;
}

export interface KeyValuePair {
    key: OCRWord[];
    value: OCRWord[];
    keyText: string;
    valueText: string;
    confidence: number;
    type: PIIType;
    bbox: { x: number; y: number; w: number; h: number; pageIndex: number };
}

// ─── Spatial Grouping ────────────────────────────────────────────────────────

/**
 * Groups OCR words into lines based on Y-coordinate proximity.
 * Tolerance is adaptive based on median word height.
 */
export function groupWordsIntoLines(words: OCRWord[]): TextLine[] {
    if (words.length === 0) return [];

    // Calculate median word height for adaptive tolerance
    const heights = words.map(w => w.bbox.h).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 20;
    const yTolerance = medianHeight * 0.5; // 50% of median height

    // Sort words by Y first, then X
    const sorted = [...words].sort((a, b) => {
        const yDiff = a.bbox.y - b.bbox.y;
        if (Math.abs(yDiff) < yTolerance) {
            return a.bbox.x - b.bbox.x; // Same line, sort by X
        }
        return yDiff;
    });

    const lines: TextLine[] = [];
    let currentLine: OCRWord[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const prevWord = sorted[i - 1];
        const currWord = sorted[i];

        // Check if on same line (similar Y coordinate)
        if (Math.abs(currWord.bbox.y - prevWord.bbox.y) < yTolerance) {
            currentLine.push(currWord);
        } else {
            // Save current line and start new one
            lines.push(createTextLine(currentLine));
            currentLine = [currWord];
        }
    }

    // Push last line
    if (currentLine.length > 0) {
        lines.push(createTextLine(currentLine));
    }

    return lines;
}

function createTextLine(words: OCRWord[]): TextLine {
    const xs = words.map(w => w.bbox.x);
    const ys = words.map(w => w.bbox.y);
    const heights = words.map(w => w.bbox.h);
    const rightEdges = words.map(w => w.bbox.x + w.bbox.w);

    return {
        words,
        y: ys.reduce((a, b) => a + b, 0) / ys.length,
        x: Math.min(...xs),
        width: Math.max(...rightEdges) - Math.min(...xs),
        height: Math.max(...heights),
        text: words.map(w => w.text).join(' '),
    };
}

/**
 * Groups lines into blocks based on vertical spacing.
 * Large gaps indicate block boundaries.
 */
export function groupLinesIntoBlocks(lines: TextLine[], pageIndex: number): TextBlock[] {
    if (lines.length === 0) return [];

    // Sort lines by Y
    const sorted = [...lines].sort((a, b) => a.y - b.y);

    // Calculate average line spacing
    const spacings: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        spacings.push(sorted[i].y - (sorted[i - 1].y + sorted[i - 1].height));
    }
    const avgSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length || 20;
    const blockThreshold = avgSpacing * 2.5; // 2.5x average = new block

    const blocks: TextBlock[] = [];
    let currentBlock: TextLine[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const prevLine = sorted[i - 1];
        const currLine = sorted[i];
        const gap = currLine.y - (prevLine.y + prevLine.height);

        if (gap > blockThreshold) {
            blocks.push(createTextBlock(currentBlock, pageIndex));
            currentBlock = [currLine];
        } else {
            currentBlock.push(currLine);
        }
    }

    if (currentBlock.length > 0) {
        blocks.push(createTextBlock(currentBlock, pageIndex));
    }

    return blocks;
}

function createTextBlock(lines: TextLine[], pageIndex: number): TextBlock {
    const xs = lines.map(l => l.x);
    const ys = lines.map(l => l.y);
    const rightEdges = lines.map(l => l.x + l.width);
    const bottomEdges = lines.map(l => l.y + l.height);

    return {
        lines,
        bbox: {
            x: Math.min(...xs),
            y: Math.min(...ys),
            w: Math.max(...rightEdges) - Math.min(...xs),
            h: Math.max(...bottomEdges) - Math.min(...ys),
            pageIndex,
        },
        text: lines.map(l => l.text).join('\n'),
    };
}

// ─── Key-Value Pair Detection ────────────────────────────────────────────────

const KEY_PATTERNS: Array<{ pattern: RegExp; type: PIIType; confidence: number }> = [
    // Names
    { pattern: /^(name|patient name|customer name|account holder|holder name|full name|cardholder|person name):?$/i, type: 'NAME', confidence: 0.99 },
    { pattern: /^(father'?s? name|father name|spouse name):?$/i, type: 'NAME', confidence: 0.95 },
    
    // Addresses
    { pattern: /^(address|residence|location|billing address|shipping address|permanent address|correspondence address):?$/i, type: 'ADDRESS', confidence: 0.98 },
    
    // Phone
    { pattern: /^(phone|mobile|tel|telephone|contact|ph\.?|mob\.?|contact no\.?|phone no\.?|mobile no\.?):?$/i, type: 'PHONE', confidence: 0.97 },
    
    // Email
    { pattern: /^(email|e-mail|email id|email address):?$/i, type: 'EMAIL', confidence: 0.98 },
    
    // Aadhaar
    { pattern: /^(aadhaar|aadhar|uid|aadhaar no\.?|aadhar no\.?|aadhaar number|enrollment no\.?):?$/i, type: 'AADHAAR', confidence: 0.99 },
    
    // PAN
    { pattern: /^(pan|pan no\.?|pan number|permanent account number):?$/i, type: 'PAN', confidence: 0.99 },
    
    // Bank Account
    { pattern: /^(account no\.?|account number|a\/c no\.?|acc no\.?|acct no\.?):?$/i, type: 'ACCOUNT_NUMBER', confidence: 0.99 },
    { pattern: /^(ifsc|ifsc code|branch code|micr|micr code):?$/i, type: 'IFSC', confidence: 0.95 },
    
    // DOB
    { pattern: /^(dob|date of birth|birth date|d\.o\.b\.?):?$/i, type: 'DOB', confidence: 0.97 },
    
    // Medical
    { pattern: /^(diagnosis|condition|disease|medication|prescription|blood group|blood type):?$/i, type: 'MEDICAL', confidence: 0.90 },
    
    // Invoice/Tax
    { pattern: /^(invoice no\.?|bill no\.?|invoice number|bill number):?$/i, type: 'INVOICE_NO', confidence: 0.85 },
    { pattern: /^(gst no\.?|gstin|gst number|tax id):?$/i, type: 'GST', confidence: 0.85 },
];

/**
 * Detects key-value pairs by analyzing spatial relationships within lines.
 * Strategy: If a word matches a key pattern, look for value to its right.
 */
export function detectKeyValuePairs(lines: TextLine[], pageIndex: number): KeyValuePair[] {
    const pairs: KeyValuePair[] = [];

    for (const line of lines) {
        // Try to find key pattern in this line
        for (let i = 0; i < line.words.length; i++) {
            const word = line.words[i];
            const keyMatch = matchKeyPattern(word.text);

            if (keyMatch) {
                // Found key! Look for value to the right
                const valueWords = extractValueToRight(line.words, i);

                if (valueWords.length > 0) {
                    const keyWords = [word];
                    const valueText = valueWords.map(w => w.text).join(' ');

                    // Calculate combined bbox
                    const allWords = [...keyWords, ...valueWords];
                    const bbox = calculateBBox(allWords, pageIndex);

                    pairs.push({
                        key: keyWords,
                        value: valueWords,
                        keyText: word.text,
                        valueText,
                        confidence: keyMatch.confidence,
                        type: keyMatch.type,
                        bbox,
                    });

                    // Skip processed words
                    i += valueWords.length;
                }
            }
        }
    }

    return pairs;
}

function matchKeyPattern(text: string): { type: PIIType; confidence: number } | null {
    const cleaned = text.trim();
    for (const { pattern, type, confidence } of KEY_PATTERNS) {
        if (pattern.test(cleaned)) {
            return { type, confidence };
        }
    }
    return null;
}

/**
 * Extracts value words to the right of a key word.
 * Stops at punctuation or significant gap.
 */
function extractValueToRight(words: OCRWord[], keyIndex: number): OCRWord[] {
    const valueWords: OCRWord[] = [];

    for (let i = keyIndex + 1; i < words.length; i++) {
        const word = words[i];

        // Stop if word is another key
        if (matchKeyPattern(word.text)) break;

        // Stop at line-ending punctuation
        if (/^[.,:;!?]+$/.test(word.text.trim())) {
            if (valueWords.length > 0) break; // Only stop if we already have value
            continue; // Skip standalone punctuation
        }

        // Check horizontal gap (new column)
        if (valueWords.length > 0) {
            const prevWord = valueWords[valueWords.length - 1];
            const gap = word.bbox.x - (prevWord.bbox.x + prevWord.bbox.w);
            const avgWordWidth = prevWord.bbox.w;

            // Large gap = new column, stop
            if (gap > avgWordWidth * 2) break;
        }

        valueWords.push(word);

        // Stop after reasonable length (prevent runaway)
        if (valueWords.length >= 15) break;
    }

    return valueWords;
}

function calculateBBox(words: OCRWord[], pageIndex: number): {
    x: number; y: number; w: number; h: number; pageIndex: number;
} {
    if (words.length === 0) {
        return { x: 0, y: 0, w: 0, h: 0, pageIndex };
    }

    const xs = words.map(w => w.bbox.x);
    const ys = words.map(w => w.bbox.y);
    const rightEdges = words.map(w => w.bbox.x + w.bbox.w);
    const bottomEdges = words.map(w => w.bbox.y + w.bbox.h);

    return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...rightEdges) - Math.min(...xs),
        h: Math.max(...bottomEdges) - Math.min(...ys),
        pageIndex,
    };
}

/**
 * Converts KeyValuePairs to DetectedEntities for the main pipeline.
 */
export function keyValuePairsToEntities(pairs: KeyValuePair[]): DetectedEntity[] {
    return pairs.map(pair => ({
        id: 'kv_' + crypto.randomUUID().substring(0, 8),
        type: pair.type,
        value: pair.valueText,
        confidence: pair.confidence,
        bbox: pair.bbox,
        masked: true,
        layer: 3, // Spatial layer (higher priority than NLP)
    }));
}

/**
 * Detects table structures by analyzing alignment and spacing patterns.
 * Returns column groups for structured data extraction.
 */
export function detectTableStructure(lines: TextLine[]): Array<{ columnIndex: number; words: OCRWord[] }> {
    // Simplified table detection: group words by X-coordinate alignment
    const columns = new Map<number, OCRWord[]>();
    const xTolerance = 15; // pixels

    for (const line of lines) {
        for (const word of line.words) {
            const x = word.bbox.x;

            // Find existing column
            let found = false;
            for (const [colX, colWords] of columns) {
                if (Math.abs(x - colX) < xTolerance) {
                    colWords.push(word);
                    found = true;
                    break;
                }
            }

            if (!found) {
                columns.set(x, [word]);
            }
        }
    }

    // Convert to array and sort by X position
    const columnArray = Array.from(columns.entries())
        .sort((a, b) => a[0] - b[0])
        .map((entry, index) => ({
            columnIndex: index,
            words: entry[1],
        }));

    return columnArray;
}
