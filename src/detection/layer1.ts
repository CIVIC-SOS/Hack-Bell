import type { DetectedEntity, OCRWord } from '../types';
import { findAllRegexMatches } from './regex';
import { verhoeffValidate, luhnValidate, panValidate } from './checksums';

/**
 * Layer 1: Deterministic PII Detection
 * Runs regex matchers and validates with cryptographic checksums.
 * All matches are high-confidence (1.0 for checksum-validated).
 */
export function runLayer1Detection(
    fullText: string,
    words: OCRWord[],
    pageIndex: number = 0
): DetectedEntity[] {
    const regexMatches = findAllRegexMatches(fullText);
    const entities: DetectedEntity[] = [];

    for (const match of regexMatches) {
        let confidence = 0.85;
        let valid = true;

        switch (match.type) {
            case 'AADHAAR':
                valid = verhoeffValidate(match.value);
                confidence = valid ? 1.0 : 0.6;
                break;
            case 'CREDIT_CARD':
                valid = luhnValidate(match.value);
                confidence = valid ? 1.0 : 0.5;
                break;
            case 'PAN':
                valid = panValidate(match.value);
                confidence = valid ? 1.0 : 0.7;
                break;
            case 'PHONE':
                confidence = 0.9;
                break;
        }

        if (!valid && confidence < 0.5) continue;

        // Map text position to bounding boxes
        const bbox = mapTextToBBox(match.startIndex, match.endIndex, fullText, words, pageIndex);

        entities.push({
            id: 'l1_' + crypto.randomUUID().substring(0, 8),
            type: match.type,
            value: match.raw,
            confidence,
            bbox,
            masked: true,
            layer: 1,
        });
    }

    return entities;
}

/**
 * Merges bounding boxes from a list of OCR words into a single enclosing bbox.
 */
function mergeWordBBoxes(matchingWords: OCRWord[], pageIndex: number): DetectedEntity['bbox'] {
    const minX = Math.min(...matchingWords.map(w => w.bbox.x));
    const minY = Math.min(...matchingWords.map(w => w.bbox.y));
    const maxX = Math.max(...matchingWords.map(w => w.bbox.x + w.bbox.w));
    const maxY = Math.max(...matchingWords.map(w => w.bbox.y + w.bbox.h));
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, pageIndex };
}

/**
 * Maps a text range to a bounding box from OCR words.
 *
 * Strategy 1 (Primary): Direct token matching — split the matched text into
 * tokens and find the same sequence of tokens among the OCR words by content.
 * This is immune to character-position drift caused by Hindi/Unicode text.
 *
 * Strategy 2 (Fallback): Character-position mapping with indexOf, guarded
 * against indexOf returning -1 so that position tracking is never corrupted.
 */
function mapTextToBBox(
    startIdx: number,
    endIdx: number,
    fullText: string,
    words: OCRWord[],
    pageIndex: number
): DetectedEntity['bbox'] {
    const matchedText = fullText.substring(startIdx, endIdx).trim();

    // --- Strategy 1: Direct token matching (most reliable) ---
    const tokens = matchedText.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length > 0 && words.length > 0) {
        const clean = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '');
        const cleanedTokens = tokens.map(clean).filter(t => t.length > 0);

        if (cleanedTokens.length > 0) {
            // Sequential window match: find first contiguous run of OCR words
            // whose cleaned text matches our cleaned tokens in order.
            for (let i = 0; i <= words.length - cleanedTokens.length; i++) {
                let allMatch = true;
                for (let j = 0; j < cleanedTokens.length; j++) {
                    if (clean(words[i + j].text) !== cleanedTokens[j]) {
                        allMatch = false;
                        break;
                    }
                }
                if (allMatch) {
                    const result = mergeWordBBoxes(
                        words.slice(i, i + cleanedTokens.length),
                        pageIndex
                    );
                    return result;
                }
            }

            // Partial / fuzzy fallback: find the first token, then greedily
            // match as many subsequent tokens as possible.
            const firstTarget = cleanedTokens[0];
            for (let i = 0; i < words.length; i++) {
                if (clean(words[i].text) !== firstTarget) continue;
                const matched: OCRWord[] = [words[i]];
                let next = 1;
                for (let j = i + 1; j < words.length && next < cleanedTokens.length; j++) {
                    if (clean(words[j].text) === cleanedTokens[next]) {
                        matched.push(words[j]);
                        next++;
                    }
                }
                if (matched.length >= Math.ceil(cleanedTokens.length / 2)) {
                    const result = mergeWordBBoxes(matched, pageIndex);
                    return result;
                }
            }
        }
    }

    // --- Strategy 2: Position-based indexOf mapping (with -1 guard) ---
    let currentPos = 0;
    const matchingWords: OCRWord[] = [];

    for (const word of words) {
        const wordStart = fullText.indexOf(word.text, currentPos);
        if (wordStart === -1) continue;           // ← key fix: skip, keep currentPos intact
        const wordEnd = wordStart + word.text.length;

        if (wordEnd > startIdx && wordStart < endIdx) {
            matchingWords.push(word);
        }

        currentPos = wordEnd;
        if (wordStart > endIdx) break;
    }

    if (matchingWords.length > 0) {
        const result = mergeWordBBoxes(matchingWords, pageIndex);
        return result;
    }

    // Ultimate fallback
    return { x: 0, y: 0, w: 100, h: 20, pageIndex };
}
