/**
 * Background & Triggered Offline Sync Engine
 * Watches network online/offline transitions, runs batch sync of queued sales/orders,
 * handles conflict prevention and emits sync progress/events.
 */

import { pos as posApi } from '@/api';
import {
  getAllOfflineSales,
  updateOfflineSaleStatus,
  removeOfflineSale,
  getPendingSalesCount,
} from './offlineStorage';

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: string | null;
  lastError: string | null;
  syncedRecentlyCount: number;
}

type SyncSubscriber = (status: SyncStatus) => void;

class OfflineSyncEngine {
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isSyncing = false;
  private pendingCount = 0;
  private lastSyncTime: string | null = null;
  private lastError: string | null = null;
  private syncedRecentlyCount = 0;
  private subscribers: Set<SyncSubscriber> = new Set();
  private timer: number | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnlineChange(true));
      window.addEventListener('offline', () => this.handleOnlineChange(false));
    }
  }

  public init() {
    this.refreshPendingCount();
    // Auto-sync every 30 seconds if online
    if (typeof window !== 'undefined') {
      this.timer = window.setInterval(() => {
        if (this.isOnline && !this.isSyncing) {
          void this.syncAll();
        }
      }, 30000);
    }
  }

  public destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public subscribe(cb: SyncSubscriber): () => void {
    this.subscribers.add(cb);
    cb(this.getStatus());
    return () => {
      this.subscribers.delete(cb);
    };
  }

  public getStatus(): SyncStatus {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: this.pendingCount,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
      syncedRecentlyCount: this.syncedRecentlyCount,
    };
  }

  private emit() {
    const status = this.getStatus();
    this.subscribers.forEach((cb) => {
      try {
        cb(status);
      } catch (e) {
        console.error('[OfflineSyncEngine] Subscriber error:', e);
      }
    });
  }

  private handleOnlineChange(online: boolean) {
    this.isOnline = online;
    this.emit();
    if (online) {
      void this.syncAll();
    }
  }

  public async refreshPendingCount() {
    this.pendingCount = await getPendingSalesCount();
    this.emit();
  }

  public async syncAll(): Promise<{ successCount: number; failedCount: number }> {
    if (!this.isOnline || this.isSyncing) {
      return { successCount: 0, failedCount: 0 };
    }

    const items = await getAllOfflineSales();
    const pendingItems = items.filter((i) => i.status === 'pending' || i.status === 'failed');

    if (pendingItems.length === 0) {
      this.pendingCount = 0;
      this.emit();
      return { successCount: 0, failedCount: 0 };
    }

    this.isSyncing = true;
    this.lastError = null;
    this.emit();

    let successCount = 0;
    let failedCount = 0;

    for (const item of pendingItems) {
      try {
        await updateOfflineSaleStatus(item.id, 'syncing');

        // Call the server RPC
        const { data, error } = await posApi.processSale(
          item.payload as unknown as Parameters<typeof posApi.processSale>[0]
        );

        if (error) {
          throw new Error(error.message || 'Network sync error');
        }

        const res = data as { success?: boolean; error?: string; detail?: string } | null;
        if (res && res.success === false) {
          throw new Error(res.detail || res.error || 'Server rejected offline transaction');
        }

        // Successfully synced -> delete from queue
        await removeOfflineSale(item.id);
        successCount++;
        this.syncedRecentlyCount++;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Sync failed';
        console.warn('[OfflineSyncEngine] Failed syncing item:', item.id, err);
        failedCount++;
        this.lastError = errorMsg;
        await updateOfflineSaleStatus(item.id, 'failed', errorMsg);
      }
    }

    this.isSyncing = false;
    this.lastSyncTime = new Date().toISOString();
    this.pendingCount = await getPendingSalesCount();
    this.emit();

    return { successCount, failedCount };
  }
}

export const offlineSyncEngine = new OfflineSyncEngine();
offlineSyncEngine.init();
