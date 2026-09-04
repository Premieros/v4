/**
 * Offline POS Manager
 * Handles local caching of products/settings, queueing offline transactions,
 * and background / on-demand syncing when internet connection is restored.
 */
import { pos as posApi } from '@/api';
import type { ProcessSalePayload } from '../services/payment';
import type { Product, Category } from '@/lib/types';

const OFFLINE_QUEUE_KEY = 'pos_offline_sales_queue_v1';
const OFFLINE_PRODUCTS_CACHE_KEY = 'pos_offline_products_cache_v1';
const OFFLINE_CATEGORIES_CACHE_KEY = 'pos_offline_categories_cache_v1';

export interface QueuedSale {
  localId: string;
  payload: ProcessSalePayload;
  queuedAt: string;
  synced: boolean;
  syncError?: string;
}

export const offlinePosManager = {
  // 1. Local Cache of Catalog
  saveCatalogCache(branchId: string, products: Product[], categories: Category[]) {
    try {
      localStorage.setItem(`${OFFLINE_PRODUCTS_CACHE_KEY}_${branchId}`, JSON.stringify(products));
      localStorage.setItem(`${OFFLINE_CATEGORIES_CACHE_KEY}_${branchId}`, JSON.stringify(categories));
    } catch (e) {
      console.warn('Failed to cache catalog for offline mode', e);
    }
  },

  getCatalogCache(branchId: string): { products: Product[]; categories: Category[] } | null {
    try {
      const p = localStorage.getItem(`${OFFLINE_PRODUCTS_CACHE_KEY}_${branchId}`);
      const c = localStorage.getItem(`${OFFLINE_CATEGORIES_CACHE_KEY}_${branchId}`);
      if (p && c) {
        return {
          products: JSON.parse(p),
          categories: JSON.parse(c),
        };
      }
    } catch (e) {
      console.warn('Failed to read cached catalog', e);
    }
    return null;
  },

  // 2. Queue Operations
  getQueue(): QueuedSale[] {
    try {
      const data = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  getPendingCount(): number {
    return this.getQueue().filter((item) => !item.synced).length;
  },

  enqueueSale(payload: ProcessSalePayload): QueuedSale {
    const queue = this.getQueue();
    const queuedItem: QueuedSale = {
      localId: `offline_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      payload,
      queuedAt: new Date().toISOString(),
      synced: false,
    };
    queue.push(queuedItem);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error('Failed to store offline sale in localStorage', e);
    }
    return queuedItem;
  },

  removeSale(localId: string) {
    const queue = this.getQueue().filter((q) => q.localId !== localId);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error(e);
    }
  },

  clearSyncedSales() {
    const queue = this.getQueue().filter((q) => !q.synced);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error(e);
    }
  },

  // 3. Sync Process
  async syncAllPending(onProgress?: (synced: number, total: number) => void): Promise<{ success: number; failed: number; errors: string[] }> {
    const queue = this.getQueue();
    const pending = queue.filter((q) => !q.synced);
    if (pending.length === 0) {
      return { success: 0, failed: 0, errors: [] };
    }

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      try {
        const { data, error } = await posApi.processSale(item.payload);
        if (!error && (data as { success?: boolean })?.success) {
          item.synced = true;
          delete item.syncError;
          successCount++;
        } else {
          item.syncError = error?.message || (data as { error?: string })?.error || 'Sync failed';
          failedCount++;
          errors.push(item.syncError);
        }
      } catch (err) {
        item.syncError = err instanceof Error ? err.message : 'Network error during sync';
        failedCount++;
        errors.push(item.syncError);
      }

      if (onProgress) {
        onProgress(i + 1, pending.length);
      }
    }

    // Save updated queue (keeping failed ones, removing successfully synced ones)
    const remaining = queue.filter((q) => !q.synced);
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    } catch (e) {
      console.error(e);
    }

    return { success: successCount, failed: failedCount, errors };
  },
};
