// ─── Matching Engine ────────────────────────────────────────────────────────
// Links Gemini's forbidden phrase list back to Tesseract's word-level coordinates.
// Handles the critical edge case where Gemini groups words (e.g., "John Doe")
// but Tesseract returns them individually ("John", "Doe").

import type { OCRWord, SpatialMapEntry, RedactionZone, DetectedEntity } from '../types';

const REDACTION_PADDING = 5; // px added on each side to prevent text ghosting

// ─── Step 1: Build Spatial Map ──────────────────────────────────────────────

/**
 * Converts OCR words into a flat spatial map array.
 * Each entry has text + pixel coordinates + a redaction flag.
 */
export function buildSpatialMap(words: OCRWord[], pageIndex: number = 0): SpatialMapEntry[] {
    return words.map(w => ({
        text: w.text,
        left: w.bbox.x,
        top: w.bbox.y,
        width: w.bbox.w,
        height: w.bbox.h,
        pageIndex: w.bbox.pageIndex ?? pageIndex,
        redact: false,
    }));
}

// ─── Step 3: The Matching Engine ────────────────────────────────────────────

/**
 * Core matching function: iterates through the spatialMap and marks words
 * for redaction if they match (or are part of) a phrase in the forbidden list.
 *
 * Handles:
 * - Exact single-word matches: "9826" in forbidden → mark "9826" in map
 * - Multi-word phrase matches: "John Doe" in forbidden → mark both "John" and "Doe"
 * - Partial/fuzzy matching: strips punctuation for comparison
 * - Case-insensitive matching
 */
export function calculateRedactionZones(
    spatialMap: SpatialMapEntry[],
    forbiddenList: string[],
    _requiredFields: string[] = []
): RedactionZone[] {
    const zones: RedactionZone[] = [];
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0900-\u097F]/g, '');

    // Separate forbidden items into single-word and multi-word
    const singleWords = new Set<string>();
    const multiPhrases: { original: string; tokens: string[] }[] = [];

    for (const phrase of forbiddenList) {
        const tokens = phrase.trim().split(/\s+/).filter(t => t.length > 0);
        const cleanedTokens = tokens.map(clean).filter(t => t.length > 0);

        if (cleanedTokens.length === 0) continue;
        if (cleanedTokens.length === 1) {
            singleWords.add(cleanedTokens[0]);
        } else {
            multiPhrases.push({ original: phrase.trim(), tokens: cleanedTokens });
        }
    }

    // --- Pass 1: Multi-word phrase matching (sliding window) ---
    for (const phrase of multiPhrases) {
        const { tokens, original } = phrase;

        for (let i = 0; i <= spatialMap.length - tokens.length; i++) {
            let allMatch = true;
            for (let j = 0; j < tokens.length; j++) {
                if (clean(spatialMap[i + j].text) !== tokens[j]) {
                    allMatch = false;
                    break;
                }
            }

            if (allMatch) {
                const matchedEntries = spatialMap.slice(i, i + tokens.length);

                // Mark all constituent words for redaction
                for (let j = 0; j < tokens.length; j++) {
                    spatialMap[i + j].redact = true;
                }

                // Create a merged zone covering the full phrase
                const minLeft = Math.min(...matchedEntries.map(e => e.left));
                const minTop = Math.min(...matchedEntries.map(e => e.top));
                const maxRight = Math.max(...matchedEntries.map(e => e.left + e.width));
                const maxBottom = Math.max(...matchedEntries.map(e => e.top + e.height));

                zones.push({
                    x: minLeft - REDACTION_PADDING,
                    y: minTop - REDACTION_PADDING,
                    w: (maxRight - minLeft) + REDACTION_PADDING * 2,
                    h: (maxBottom - minTop) + REDACTION_PADDING * 2,
                    pageIndex: matchedEntries[0].pageIndex,
                    matchedPhrase: original,
                    matchedWords: matchedEntries.map(e => e.text),
                });
            }
        }

        // Fallback: partial sequential match (for OCR that split/merged words differently)
        if (!zones.some(z => z.matchedPhrase === original)) {
            const firstToken = tokens[0];
            for (let i = 0; i < spatialMap.length; i++) {
                if (clean(spatialMap[i].text) !== firstToken) continue;

                const matched: SpatialMapEntry[] = [spatialMap[i]];
                let nextToken = 1;

                // Look ahead within a reasonable window (tokens.length * 2)
                for (let j = i + 1; j < Math.min(spatialMap.length, i + tokens.length * 2) && nextToken < tokens.length; j++) {
                    if (clean(spatialMap[j].text) === tokens[nextToken]) {
                        matched.push(spatialMap[j]);
                        nextToken++;
                    }
                }

                // Accept if we matched at least 60% of tokens
                if (matched.length >= Math.ceil(tokens.length * 0.6)) {
                    for (const entry of matched) {
                        entry.redact = true;
                    }

                    const minLeft = Math.min(...matched.map(e => e.left));
                    const minTop = Math.min(...matched.map(e => e.top));
                    const maxRight = Math.max(...matched.map(e => e.left + e.width));
                    const maxBottom = Math.max(...matched.map(e => e.top + e.height));

                    zones.push({
                        x: minLeft - REDACTION_PADDING,
                        y: minTop - REDACTION_PADDING,
                        w: (maxRight - minLeft) + REDACTION_PADDING * 2,
                        h: (maxBottom - minTop) + REDACTION_PADDING * 2,
                        pageIndex: matched[0].pageIndex,
                        matchedPhrase: original,
                        matchedWords: matched.map(e => e.text),
                    });
                    break;
                }
            }
        }
    }

    // --- Pass 2: Single-word matching ---
    for (let i = 0; i < spatialMap.length; i++) {
        const entry = spatialMap[i];
        if (entry.redact) continue; // Already marked by phrase match

        const cleaned = clean(entry.text);
        if (cleaned.length === 0) continue;

        if (singleWords.has(cleaned)) {
            entry.redact = true;

            zones.push({
                x: entry.left - REDACTION_PADDING,
                y: entry.top - REDACTION_PADDING,
                w: entry.width + REDACTION_PADDING * 2,
                h: entry.height + REDACTION_PADDING * 2,
                pageIndex: entry.pageIndex,
                matchedPhrase: entry.text,
                matchedWords: [entry.text],
            });
        }
    }

    // Merge overlapping/adjacent zones to reduce draw calls
    return mergeAdjacentZones(zones);
}

// ─── Zone Merging ───────────────────────────────────────────────────────────

/**
 * Merges overlapping or adjacent (within 2px) redaction zones.
 * This prevents redundant fillRect calls and visual artifacts.
 */
function mergeAdjacentZones(zones: RedactionZone[]): RedactionZone[] {
    if (zones.length <= 1) return zones;

    // Sort by page, then Y, then X
    const sorted = [...zones].sort((a, b) => {
        if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
        if (Math.abs(a.y - b.y) > 5) return a.y - b.y;
        return a.x - b.x;
    });

    const merged: RedactionZone[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];

        // Check if zones overlap or are adjacent (within 2px gap)
        if (
            current.pageIndex === last.pageIndex &&
            current.x <= last.x + last.w + 2 &&
            current.y <= last.y + last.h + 2 &&
            current.y + current.h >= last.y - 2
        ) {
            // Merge
            const newX = Math.min(last.x, current.x);
            const newY = Math.min(last.y, current.y);
            const newRight = Math.max(last.x + last.w, current.x + current.w);
            const newBottom = Math.max(last.y + last.h, current.y + current.h);

            last.x = newX;
            last.y = newY;
            last.w = newRight - newX;
            last.h = newBottom - newY;
            last.matchedWords = [...last.matchedWords, ...current.matchedWords];
            last.matchedPhrase += ' | ' + current.matchedPhrase;
        } else {
            merged.push({ ...current });
        }
    }

    return merged;
}

// ─── Convert Zones to DetectedEntities ──────────────────────────────────────

/**
 * Converts RedactionZones into DetectedEntity[] for use by the existing
 * ReviewModal and redaction pipeline.
 */
export function zonesToEntities(zones: RedactionZone[]): DetectedEntity[] {
    return zones.map((zone) => ({
        id: 'mz_' + crypto.randomUUID().substring(0, 8),
        type: 'SENSITIVE' as const,
        value: zone.matchedPhrase,
        confidence: 0.9,
        bbox: {
            x: Math.max(0, zone.x),
            y: Math.max(0, zone.y),
            w: zone.w,
            h: zone.h,
            pageIndex: zone.pageIndex,
        },
        masked: true,
        layer: 3 as const,
    }));
}
