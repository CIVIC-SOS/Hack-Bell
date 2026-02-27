// ─── Advanced Detection Worker ──────────────────────────────────────────────
// Implements multi-stage detection pipeline with spatial awareness
// Integrates: Document Router → Spatial Mapper → Fusion Engine

import type { OCRWord, DetectedEntity, PIIType } from '../types';
import {
    groupWordsIntoLines,
    groupLinesIntoBlocks,
    detectKeyValuePairs,
    keyValuePairsToEntities,
    detectTableStructure,
} from '../detection/spatialMapper';
import { classifyDocument, getRulesetForDocType } from '../detection/documentRouter';
import { FusionEngine } from '../detection/fusionEngine';
import { runLayer1Detection } from '../detection/layer1';

interface AdvancedDetectionRequest {
    type: 'ADVANCED_DETECT';
    fullText: string;
    words: OCRWord[];
    pageIndex: number;
    confidenceThreshold: number;
}

interface AdvancedDetectionResponse {
    type: 'DETECTION_RESULT' | 'DETECTION_ERROR';
    entities?: DetectedEntity[];
    documentType?: string;
    stats?: any;
    error?: string;
}

// ─── NLP Heuristic Detection (Inline for Worker) ────────────────────────────

const COMMON_FIRST_NAMES = new Set([
    'aarav', 'aditi', 'aditya', 'akash', 'amit', 'amita', 'ananya', 'anil', 'anita', 'anjali',
    'ankita', 'arjun', 'arun', 'aruna', 'ashok', 'bhavna', 'chandra', 'deepak', 'deepika',
    'rahul', 'rajesh', 'priya', 'neha', 'vikram', 'sneha', 'pooja', 'rohit', 'john', 'james',
    'mary', 'patricia', 'jennifer', 'michael', 'william', 'david', 'sarah', 'karen',
]);

const COMMON_LAST_NAMES = new Set([
    'sharma', 'verma', 'gupta', 'singh', 'kumar', 'patel', 'joshi', 'mishra', 'agarwal', 'mehta',
    'reddy', 'rao', 'nair', 'menon', 'iyer', 'mukherjee', 'chatterjee', 'das', 'roy', 'shah',
    'smith', 'johnson', 'williams', 'brown', 'jones', 'davis', 'miller', 'wilson', 'moore',
]);

function detectNamesHeuristic(words: OCRWord[]): DetectedEntity[] {
    const entities: DetectedEntity[] = [];

    for (let i = 0; i < words.length; i++) {
        const word = words[i].text.replace(/[^a-zA-Z]/g, '').toLowerCase();
        if (word.length < 2) continue;

        if (COMMON_FIRST_NAMES.has(word) || COMMON_LAST_NAMES.has(word)) {
            let fullName = words[i].text;
            let bbox = { ...words[i].bbox };
            let confidence = 0.65;

            // Look for multi-word names
            if (i + 1 < words.length) {
                const nextWord = words[i + 1].text.replace(/[^a-zA-Z]/g, '').toLowerCase();
                if (COMMON_FIRST_NAMES.has(nextWord) || COMMON_LAST_NAMES.has(nextWord)) {
                    fullName += ' ' + words[i + 1].text;
                    bbox.w = (words[i + 1].bbox.x + words[i + 1].bbox.w) - bbox.x;
                    confidence = 0.78;
                    i++;
                }
            }

            entities.push({
                id: 'nlp_' + crypto.randomUUID().substring(0, 8),
                type: 'NAME',
                value: fullName,
                confidence,
                bbox,
                masked: true,
                layer: 2, // NLP heuristic layer
            });
        }
    }

    return entities;
}

// ─── Main Worker Handler ────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<AdvancedDetectionRequest>) => {
    const { type, fullText, words, pageIndex, confidenceThreshold } = e.data;

    if (type !== 'ADVANCED_DETECT') return;

    try {
        console.log(`[Advanced Detection Worker] Starting multi-stage detection...`);
        console.log(`[Advanced Detection Worker] Input: ${words.length} words, ${fullText.length} chars`);

        // ────────────────────────────────────────────────────────────────────
        // STAGE 1: Document Classification (Router)
        // ────────────────────────────────────────────────────────────────────

        const classification = classifyDocument(fullText);
        const ruleset = getRulesetForDocType(classification.primaryType);

        console.log(`[Advanced Detection Worker] Document Type: ${classification.primaryType} (${Math.round(classification.confidence * 100)}%)`);
        console.log(`[Advanced Detection Worker] Ruleset:`, ruleset);

        // ────────────────────────────────────────────────────────────────────
        // STAGE 2: Spatial Context Mapping
        // ────────────────────────────────────────────────────────────────────

        let spatialEntities: DetectedEntity[] = [];

        if (ruleset.prioritizeSpatialContext) {
            console.log(`[Advanced Detection Worker] Running spatial analysis...`);

            const lines = groupWordsIntoLines(words);
            console.log(`[Advanced Detection Worker] Grouped into ${lines.length} lines`);

            const blocks = groupLinesIntoBlocks(lines, pageIndex);
            console.log(`[Advanced Detection Worker] Grouped into ${blocks.length} blocks`);

            // Detect key-value pairs
            const kvPairs = detectKeyValuePairs(lines, pageIndex);
            console.log(`[Advanced Detection Worker] Detected ${kvPairs.length} key-value pairs`);

            spatialEntities = keyValuePairsToEntities(kvPairs);

            // Table detection (for invoices and bank statements)
            if (ruleset.enableTableDetection) {
                const tableColumns = detectTableStructure(lines);
                console.log(`[Advanced Detection Worker] Detected ${tableColumns.length} table columns`);
            }
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 3: Deterministic Regex Detection (Layer 1)
        // ────────────────────────────────────────────────────────────────────

        console.log(`[Advanced Detection Worker] Running regex detection...`);
        const regexEntities = runLayer1Detection(fullText, words, pageIndex);
        console.log(`[Advanced Detection Worker] Regex detected: ${regexEntities.length}`);

        // ────────────────────────────────────────────────────────────────────
        // STAGE 4: NLP Heuristic Detection (Layer 2)
        // ────────────────────────────────────────────────────────────────────

        let nlpEntities: DetectedEntity[] = [];

        if (!ruleset.skipParagraphNER) {
            console.log(`[Advanced Detection Worker] Running NLP heuristics...`);
            nlpEntities = detectNamesHeuristic(words);
            console.log(`[Advanced Detection Worker] NLP detected: ${nlpEntities.length}`);
        }

        // ────────────────────────────────────────────────────────────────────
        // STAGE 5: Confidence Fusion
        // ────────────────────────────────────────────────────────────────────

        console.log(`[Advanced Detection Worker] Fusing detections...`);

        const fusionEngine = new FusionEngine({
            documentType: classification.primaryType,
            confidenceThreshold,
            preferSpatialOverNLP: ruleset.prioritizeSpatialContext,
            deduplicationOverlapThreshold: 0.5,
        });

        const fusionResult = fusionEngine.fuse(
            regexEntities,
            spatialEntities,
            nlpEntities,
            [] // ML/Gemini entities come from main pipeline
        );

        console.log(`[Advanced Detection Worker] Fusion complete: ${fusionResult.entities.length} entities`);
        console.log(`[Advanced Detection Worker] Stats:`, fusionResult.stats);

        // Apply document-type-specific confidence boost
        const boostedEntities = fusionEngine.applyDocumentTypeBoost(fusionResult.entities);

        // ────────────────────────────────────────────────────────────────────
        // STAGE 6: Return Results
        // ────────────────────────────────────────────────────────────────────

        const response: AdvancedDetectionResponse = {
            type: 'DETECTION_RESULT',
            entities: boostedEntities,
            documentType: classification.primaryType,
            stats: {
                ...fusionResult.stats,
                documentConfidence: Math.round(classification.confidence * 100),
                detectedKeywords: classification.detectedKeywords.slice(0, 5),
            },
        };

        self.postMessage(response);

        // Cleanup to prevent memory leaks
        regexEntities.length = 0;
        spatialEntities.length = 0;
        nlpEntities.length = 0;

    } catch (error) {
        console.error('[Advanced Detection Worker] Error:', error);
        self.postMessage({
            type: 'DETECTION_ERROR',
            error: error instanceof Error ? error.message : 'Detection failed',
        });
    }
};

// Worker ready signal
self.postMessage({ type: 'WORKER_READY' });
