import type { OCRResponse, OCRWord, DetectedEntity } from '../types';

type WorkerCallback = (response: any) => void;

export class WorkerPool {
    private ocrWorker: Worker | null = null;
    private advancedWorker: Worker | null = null;
    private ocrCallbacks: Map<string, WorkerCallback> = new Map();
    private advancedCallbacks: Map<string, WorkerCallback> = new Map();
    private progressCallback: ((progress: number, message: string) => void) | null = null;

    setProgressCallback(cb: (progress: number, message: string) => void): void {
        this.progressCallback = cb;
    }

    private initOCRWorker(): Worker {
        if (this.ocrWorker) return this.ocrWorker;
        this.ocrWorker = new Worker(
            new URL('./ocr.worker.ts', import.meta.url),
            { type: 'module' }
        );
        this.ocrWorker.onmessage = (e: MessageEvent<OCRResponse>) => {
            const data = e.data;
            if (data.type === 'OCR_PROGRESS' && this.progressCallback) {
                this.progressCallback(data.progress ?? 0, data.message ?? 'Processing document...');
                return;
            }
            // Resolve any pending callback
            for (const [id, cb] of this.ocrCallbacks) {
                cb(data);
                this.ocrCallbacks.delete(id);
                break;
            }
        };
        return this.ocrWorker;
    }

    private initAdvancedWorker(): Worker {
        if (this.advancedWorker) return this.advancedWorker;
        this.advancedWorker = new Worker(
            new URL('./advanced.worker.ts', import.meta.url),
            { type: 'module' }
        );
        this.advancedWorker.onmessage = (e: MessageEvent) => {
            const data = e.data;
            
            if (data.type === 'WORKER_READY') {
                console.log('[WorkerPool] Advanced detection worker ready');
                return;
            }

            // Resolve any pending callback
            for (const [id, cb] of this.advancedCallbacks) {
                cb(data);
                this.advancedCallbacks.delete(id);
                break;
            }
        };
        return this.advancedWorker;
    }

    async runOCR(
        fileBuffer: ArrayBuffer,
        fileType: string,
        pageIndex: number = 0
    ): Promise<{ words: OCRWord[]; fullText: string }> {
        const worker = this.initOCRWorker();
        const id = crypto.randomUUID();

        return new Promise((resolve, reject) => {
            this.ocrCallbacks.set(id, (response) => {
                const r = response as OCRResponse;
                if (r.type === 'OCR_ERROR') {
                    reject(new Error(r.error));
                } else if (r.type === 'OCR_RESULT') {
                    resolve({
                        words: r.words ?? [],
                        fullText: r.fullText ?? '',
                    });
                }
            });

            // Transfer the buffer (zero-copy)
            const bufferCopy = fileBuffer.slice(0);
            worker.postMessage(
                { type: 'OCR_START', fileBuffer: bufferCopy, fileType, pageIndex },
                [bufferCopy]
            );
        });
    }

    async runAdvancedDetection(
        fullText: string,
        words: OCRWord[],
        pageIndex: number,
        confidenceThreshold: number
    ): Promise<{ entities: DetectedEntity[]; documentType: string; stats: any }> {
        const worker = this.initAdvancedWorker();
        const id = crypto.randomUUID();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.advancedCallbacks.delete(id);
                reject(new Error('Advanced detection worker timeout'));
            }, 30000); // 30 second timeout

            this.advancedCallbacks.set(id, (response) => {
                clearTimeout(timeout);

                if (response.type === 'DETECTION_ERROR') {
                    reject(new Error(response.error));
                } else if (response.type === 'DETECTION_RESULT') {
                    resolve({
                        entities: response.entities ?? [],
                        documentType: response.documentType ?? 'generic',
                        stats: response.stats ?? {},
                    });
                }
            });

            worker.postMessage({
                type: 'ADVANCED_DETECT',
                fullText,
                words,
                pageIndex,
                confidenceThreshold,
            });
        });
    }

    terminate(): void {
        this.ocrWorker?.terminate();
        this.advancedWorker?.terminate();
        this.ocrWorker = null;
        this.advancedWorker = null;
        this.ocrCallbacks.clear();
        this.advancedCallbacks.clear();
    }
}
