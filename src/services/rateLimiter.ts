/**
 * TMDB Rate Limiter - Token Bucket Algorithm
 *
 * - Burst: jusqu'à 20 requêtes immédiates (Dashboard load = ~8-15 req avec genres)
 * - Refill: 1 token/seconde (= 60 req/min, aligné sur le serveur Edge Function)
 * - Parallelism: dispatches up to available tokens concurrently
 * - Retry: 3 tentatives avec exponential backoff sur 429
 *
 * ANTI-HALLUCINATION:
 * ⚠️ Ce rate limiter est un SINGLETON exporté comme `tmdbRateLimiter`
 * ⚠️ TOUTES les requêtes TMDB DOIVENT passer par `tmdbRateLimiter.execute()`
 * ⚠️ NE PAS créer de nouvelles instances (risque de contournement du rate limit)
 * ⚠️ Les 429 sont gérés automatiquement avec retry + exponential backoff
 */

import { createLogger } from '../utils/logger';

const log = createLogger('RateLimiter');

type QueuedRequest<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

class TmdbTokenBucketLimiter {
  private queue: QueuedRequest<unknown>[] = [];
  private processing = false;
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private lastRefillTime: number;
  private requestCount = 0;

  constructor(maxTokens: number = 10, tokensPerSecond: number = 10) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens; // Start with full bucket
    this.refillRate = tokensPerSecond / 1000; // tokens per ms
    this.lastRefillTime = Date.now();
  }

  /**
   * Execute a function through the rate limiter
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve: resolve as (v: unknown) => void, reject });
      if (!this.processing) {
        void this.process();
      }
    });
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refillTokens() {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  /**
   * Wait for a token to be available
   */
  private async waitForToken(): Promise<void> {
    this.refillTokens();

    if (this.tokens >= 1) {
      // Token available immediately
      return;
    }

    // Calculate wait time for next token
    const tokensNeeded = 1 - this.tokens;
    const waitTime = Math.ceil(tokensNeeded / this.refillRate);

    await this.sleep(waitTime);
    this.refillTokens();
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      // Coalesce: 50ms window to let concurrent requests accumulate in queue
      // before dispatching. Without this, the first request would be dispatched
      // alone while others are still resolving their getCachedList/getSession.
      await this.sleep(50);

      await this.waitForToken();

      // Dispatch up to available tokens in parallel (batch)
      const batch: Promise<void>[] = [];
      while (this.tokens >= 1 && this.queue.length > 0) {
        this.tokens -= 1;
        const request = this.queue.shift()!;
        this.requestCount++;

        batch.push(
          this.executeWithRetry(request.fn)
            .then((result) => request.resolve(result))
            .catch((e) => request.reject(e))
        );
      }

      // Wait for the entire batch to finish before refilling
      await Promise.all(batch);
    }

    this.processing = false;
  }

  /**
   * Execute with retry + exponential backoff on 429
   */
  private async executeWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
    try {
      return await fn();
    } catch (e: unknown) {
      const error = e as { status?: number; message?: string };

      if (error.status === 429 && retries > 0) {
        log.warn(
          `⚠️ 429 Too Many Requests - Retry dans ${delay}ms (${retries} restants)`
        );
        await this.sleep(delay);
        return this.executeWithRetry(fn, retries - 1, delay * 2);
      }

      throw e;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Get stats for debugging
   */
  getStats() {
    this.refillTokens();
    return {
      totalRequests: this.requestCount,
      queueLength: this.queue.length,
      availableTokens: this.tokens.toFixed(1),
      maxTokens: this.maxTokens,
    };
  }
}

// Export singleton: 20 burst, 1 refill/s (= 60 req/min, aligned with server Edge Function)
export const tmdbRateLimiter = new TmdbTokenBucketLimiter(20, 1);
