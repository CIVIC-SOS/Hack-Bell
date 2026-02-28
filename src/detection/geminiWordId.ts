// ─── Gemini Word-ID PII Detection ───────────────────────────────────────────
// This module implements a pixel-perfect PII detection strategy:
//
// 1. Send Tesseract OCR words as a JSON array of { id, text } tokens to Gemini
// 2. Gemini reconstructs sentences, identifies PII, and returns exact word IDs
// 3. Map those IDs back to the original Tesseract data for pixel-perfect bboxes
//
// This eliminates fuzzy text matching entirely — no more missed detections
// due to OCR text differences or phrase-boundary mismatches.

import type { DetectedEntity, OCRWord, PIIType } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GeminiWordToken {
  id: number;
  text: string;
}

interface GeminiPIIEntity {
  type: string;
  value: string;
  wordIds: number[];
}

interface RedactionMask {
  id: string;
  type: PIIType;
  textValue: string;
  coordinates: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  };
  selectedForMasking: boolean;
}

// ─── Category Mapping ───────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, PIIType> = {
  'name': 'NAME',
  'person': 'NAME',
  'full_name': 'NAME',
  'person_name': 'NAME',
  'first_name': 'NAME',
  'last_name': 'NAME',
  'phone_number': 'PHONE',
  'phone': 'PHONE',
  'mobile': 'PHONE',
  'mobile_number': 'PHONE',
  'telephone': 'PHONE',
  'contact_number': 'PHONE',
  'email': 'EMAIL',
  'email_address': 'EMAIL',
  'address': 'ADDRESS',
  'physical_address': 'ADDRESS',
  'location': 'ADDRESS',
  'residence': 'ADDRESS',
  'home_address': 'ADDRESS',
  'aadhaar': 'AADHAAR',
  'aadhaar_number': 'AADHAAR',
  'aadhar': 'AADHAAR',
  'uid': 'AADHAAR',
  'pan': 'PAN',
  'pan_number': 'PAN',
  'permanent_account_number': 'PAN',
  'passport_id': 'PAN',
  'credit_card': 'CREDIT_CARD',
  'credit_card_number': 'CREDIT_CARD',
  'card_number': 'CREDIT_CARD',
  'debit_card': 'CREDIT_CARD',
  'dob': 'DOB',
  'date_of_birth': 'DOB',
  'birth_date': 'DOB',
  'birthday': 'DOB',
  'medical': 'MEDICAL',
  'health': 'MEDICAL',
  'diagnosis': 'MEDICAL',
  'disease': 'MEDICAL',
  'medication': 'MEDICAL',
  'medical_condition': 'MEDICAL',
  'prescription': 'MEDICAL',
  'account_number': 'ACCOUNT_NUMBER',
  'bank_account': 'ACCOUNT_NUMBER',
  'ifsc': 'IFSC',
  'ifsc_code': 'IFSC',
  'invoice_no': 'INVOICE_NO',
  'invoice_number': 'INVOICE_NO',
  'gst': 'GST',
  'gstin': 'GST',
  'gst_number': 'GST',
  'ssn': 'SENSITIVE',
  'social_security_number': 'SENSITIVE',
  'id_number': 'SENSITIVE',
  'financial_details': 'SENSITIVE',
};

function mapCategory(category: string): PIIType {
  const normalized = (category ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return CATEGORY_MAP[normalized] ?? 'SENSITIVE';
}

// ─── Step 1: Tokenize OCR Words ─────────────────────────────────────────────

/**
 * Converts OCR words into a flat array of { id, text } tokens for Gemini.
 * The `id` is the array index, which we'll use to map back to coordinates.
 */
export function tokenizeOCRWords(words: OCRWord[]): GeminiWordToken[] {
  return words.map((word, index) => ({
    id: index,
    text: word.text,
  }));
}

// ─── Step 2: Call Gemini with Word-ID Prompt ────────────────────────────────

/**
 * Sends tokenized OCR words to Gemini and asks it to identify PII,
 * returning exact word IDs for each detected entity.
 *
 * This is the core innovation: Gemini sees the tokens with IDs and returns
 * the exact IDs that constitute each PII entity — no fuzzy matching needed.
 */
export async function runGeminiWordIdDetection(
  words: OCRWord[],
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<GeminiPIIEntity[]> {
  if (!apiKey || words.length === 0) return [];

  onProgress?.('Tokenizing OCR data for Gemini...');

  const tokens = tokenizeOCRWords(words);

  // Chunk tokens if the document is very large (>500 tokens)
  // to stay within Gemini's context window limits
  const MAX_TOKENS_PER_CALL = 800;
  const allEntities: GeminiPIIEntity[] = [];

  for (let chunkStart = 0; chunkStart < tokens.length; chunkStart += MAX_TOKENS_PER_CALL) {
    const chunk = tokens.slice(chunkStart, chunkStart + MAX_TOKENS_PER_CALL);

    onProgress?.(`Analyzing tokens ${chunkStart + 1}–${chunkStart + chunk.length} of ${tokens.length}...`);

    const chunkEntities = await callGeminiWithTokens(chunk, apiKey);
    allEntities.push(...chunkEntities);
  }

  return allEntities;
}

async function callGeminiWithTokens(
  tokens: GeminiWordToken[],
  apiKey: string
): Promise<GeminiPIIEntity[]> {
  const tokensJson = JSON.stringify(tokens);

  const prompt = `You are an expert data privacy assistant specializing in PII detection.

I will provide you with a JSON array representing text extracted from a document. Each object in the array contains an "id" and a "text" (a single word or token). 

Your task is to:
1. Reconstruct Sentences: Logically read the sequential tokens to understand the context of the document.
2. Identify Sensitive Information: Find any Personally Identifiable Information (PII) or sensitive data. This includes: Names, Phone Numbers, Email Addresses, Physical Addresses, Social Security Numbers, ID/Passport Numbers, Credit Card Numbers, Financial Details, Dates of Birth, Aadhaar Numbers, PAN Numbers, Medical Information, Account Numbers, IFSC Codes, Invoice Numbers, and GST Numbers.
3. Map the Tokens: For every piece of sensitive information you find, record the exact "id" numbers of the words that make up that information.
4. Output Format: Return your findings STRICTLY as a JSON array of objects. Do not wrap the response in markdown code blocks and do not include any conversational text.

Use this exact JSON schema for your output:
[
  {
    "type": "TYPE_OF_SENSITIVE_INFO",
    "value": "The full sensitive phrase reconstructed",
    "wordIds": [Array of the exact "id" integers that make up this phrase]
  }
]

Valid types: NAME, PHONE_NUMBER, EMAIL, ADDRESS, AADHAAR, PAN, CREDIT_CARD, DOB, MEDICAL, ACCOUNT_NUMBER, IFSC, INVOICE_NO, GST, SENSITIVE

If no sensitive information is found, return an empty array: []

Here is the document data:
${tokensJson}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errText || response.statusText}`);
  }

  const data = await response.json();
  const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Extract JSON array from the response (handles markdown wrapping gracefully)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let items: GeminiPIIEntity[] = [];
  try {
    items = JSON.parse(jsonMatch[0]);
  } catch {
    console.warn('[Gemini WordID] Returned invalid JSON:', raw);
    return [];
  }

  // Validate the structure of each entity
  const validated = items.filter(item =>
    item &&
    typeof item.type === 'string' &&
    typeof item.value === 'string' &&
    Array.isArray(item.wordIds) &&
    item.wordIds.length > 0 &&
    item.wordIds.every(id => typeof id === 'number')
  );

  console.log(`[Gemini WordID] Detected ${validated.length} PII entities`);
  return validated;
}

// ─── Step 3: Calculate Pixel-Perfect Redaction Masks ────────────────────────

/**
 * Maps Gemini PII output back to original Tesseract data to calculate
 * pixel-perfect bounding boxes.
 *
 * @param tesseractData - The original OCR data containing bounding box info
 * @param geminiOutput  - The JSON response from Gemini containing wordIds
 * @returns Array of mask objects with calculated coordinates
 */
export function calculateRedactionMasks(
  tesseractData: OCRWord[],
  geminiOutput: GeminiPIIEntity[]
): RedactionMask[] {
  if (!geminiOutput || geminiOutput.length === 0) return [];

  return geminiOutput.map(entity => {
    // Grab the actual word objects from the original Tesseract data using the IDs
    // The `id` Gemini returns maps directly to the array index
    const matchedWords = tesseractData.filter((_, index) =>
      entity.wordIds.includes(index)
    );

    // Safety check for hallucinated IDs
    if (matchedWords.length === 0) {
      console.warn(`[Redaction Masks] No matching words found for entity: ${entity.value}`);
      return null;
    }

    // Calculate the extreme edges to form a master bounding box
    const startX = Math.min(...matchedWords.map(word => word.bbox.x));
    const startY = Math.min(...matchedWords.map(word => word.bbox.y));
    const endX = Math.max(...matchedWords.map(word => word.bbox.x + word.bbox.w));
    const endY = Math.max(...matchedWords.map(word => word.bbox.y + word.bbox.h));

    return {
      id: crypto.randomUUID(),
      type: mapCategory(entity.type),
      textValue: entity.value,
      coordinates: { startX, startY, endX, endY },
      selectedForMasking: true,
    };
  }).filter((mask): mask is RedactionMask => mask !== null);
}

// ─── Step 4: Convert Masks to DetectedEntity[] ─────────────────────────────

const MASK_PADDING = 4; // px padding around each mask

/**
 * Converts RedactionMask[] into DetectedEntity[] format used by the existing
 * pipeline (ReviewModal, redaction engine, etc.)
 *
 * This bridges the new word-ID approach with the existing entity system.
 */
export function masksToEntities(
  masks: RedactionMask[],
  pageIndex: number = 0
): DetectedEntity[] {
  return masks.map(mask => ({
    id: 'wid_' + mask.id.substring(0, 8),
    type: mask.type,
    value: mask.textValue,
    confidence: 0.95, // High confidence: exact word-ID mapping
    bbox: {
      x: Math.max(0, mask.coordinates.startX - MASK_PADDING),
      y: Math.max(0, mask.coordinates.startY - MASK_PADDING),
      w: (mask.coordinates.endX - mask.coordinates.startX) + MASK_PADDING * 2,
      h: (mask.coordinates.endY - mask.coordinates.startY) + MASK_PADDING * 2,
      pageIndex,
    },
    masked: mask.selectedForMasking,
    layer: 4 as const, // Layer 4 = ML/Gemini word-ID detection (highest priority)
  }));
}

// ─── Full Pipeline Entry Point ──────────────────────────────────────────────

/**
 * Complete word-ID-based PII detection pipeline.
 *
 * Flow:
 * 1. Tokenize OCR words into { id, text } array
 * 2. Send to Gemini → get back PII entities with exact word IDs
 * 3. Map word IDs back to Tesseract bboxes → pixel-perfect masks
 * 4. Convert to DetectedEntity[] for the existing UI pipeline
 *
 * @param words       - OCR words from Tesseract with bounding box data
 * @param apiKey      - Gemini API key
 * @param pageIndex   - Page index for multi-page documents
 * @param onProgress  - Progress callback
 * @returns DetectedEntity[] ready for ReviewModal and redaction
 */
export async function runWordIdPipeline(
  words: OCRWord[],
  apiKey: string,
  pageIndex: number = 0,
  onProgress?: (msg: string) => void
): Promise<DetectedEntity[]> {
  if (!apiKey || words.length === 0) return [];

  onProgress?.('Running word-ID PII detection...');

  // Step 1-2: Get PII entities with word IDs from Gemini
  const piiEntities = await runGeminiWordIdDetection(words, apiKey, onProgress);

  if (piiEntities.length === 0) {
    console.log('[WordID Pipeline] No PII detected by Gemini');
    return [];
  }

  // Step 3: Calculate pixel-perfect masks
  onProgress?.('Calculating redaction coordinates...');
  const masks = calculateRedactionMasks(words, piiEntities);

  // Step 4: Convert to DetectedEntity[]
  const entities = masksToEntities(masks, pageIndex);

  console.log(`[WordID Pipeline] Generated ${entities.length} entities from ${piiEntities.length} PII detections`);

  return entities;
}
