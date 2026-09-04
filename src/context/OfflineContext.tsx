import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { offlineSyncEngine, type SyncStatus } from '@/core/offline/syncEngine';
import {
  saveOfflineCache,
  getOfflineCache,
  saveOfflineSetting,
  getOfflineSetting,
  enqueueOfflineSale,
  getAllOfflineSales,
  removeOfflineSale,
  type OfflineSaleQueueItem,
} from '@/core/offline/offlineStorage';
import type { Product, Category, Customer, DiningTable, Settings, Branch } from '@/lib/types';

interface OfflineContextValue {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: string | null;
  lastError: string | null;
  syncedRecentlyCount: number;
  syncNow: () => Promise<{ successCount: number; failedCount: number }>;
  cachePosData: (data: {
    branchId: string;
    products?: Product[];
    categories?: Category[];
    customers?: Customer[];
    tables?: DiningTable[];
    settings?: Settings | null;
    branches?: Branch[];
    stockMap?: Record<string, number>;
  }) => Promise<void>;
  loadCachedPosData: (branchId?: string) => Promise<{
    products: Product[];
    categories: Category[];
    customers: Customer[];
    tables: DiningTable[];
    settings: Settings | null;
    stockMap: Record<string, number>;
  }>;
  queueSaleForOffline: (invoiceNumber: string, payload: Record<string, unknown>) => Promise<string>;
  getOfflineQueue: () => Promise<OfflineSaleQueueItem[]>;
  discardQueuedSale: (id: string) => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>(() => offlineSyncEngine.getStatus());

  useEffect(() => {
    const unsub = offlineSyncEngine.subscribe((st) => setStatus(st));
    return unsub;
  }, []);

  const syncNow = useCallback(async () => {
    return await offlineSyncEngine.syncAll();
  }, []);

  const cachePosData = useCallback(
    async (data: {
      branchId: string;
      products?: Product[];
      categories?: Category[];
      customers?: Customer[];
      tables?: DiningTable[];
      settings?: Settings | null;
      branches?: Branch[];
      stockMap?: Record<string, number>;
    }) => {
      if (data.products) await saveOfflineCache('products', data.products);
      if (data.categories) await saveOfflineCache('categories', data.categories);
      if (data.customers) await saveOfflineCache('customers', data.customers);
      if (data.tables) await saveOfflineCache('dining_tables', data.tables);
      if (data.settings) await saveOfflineSetting('settings_' + data.branchId, data.settings);
      if (data.stockMap) {
        const stockItems = Object.entries(data.stockMap).map(([productId, quantity]) => ({
          productId,
          quantity,
        }));
        await saveOfflineCache('stock_map', stockItems);
      }
    },
    []
  );

  const loadCachedPosData = useCallback(async (branchId?: string) => {
    const [products, categories, customers, tables, stockArr, cachedSettings] = await Promise.all([
      getOfflineCache<Product>('products'),
      getOfflineCache<Category>('categories'),
      getOfflineCache<Customer>('customers'),
      getOfflineCache<DiningTable>('dining_tables'),
      getOfflineCache<{ productId: string; quantity: number }>('stock_map'),
      branchId ? getOfflineSetting<Settings>('settings_' + branchId) : null,
    ]);

    const stockMap: Record<string, number> = {};
    for (const item of stockArr) {
      stockMap[item.productId] = item.quantity;
    }

    return {
      products,
      categories,
      customers,
      tables,
      settings: cachedSettings || null,
      stockMap,
    };
  }, []);

  const queueSaleForOffline = useCallback(async (invoiceNumber: string, payload: Record<string, unknown>): Promise<string> => {
    const id = 'offline_sale_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    await enqueueOfflineSale({
      id,
      client_id: id,
      invoice_number: invoiceNumber,
      created_at: new Date().toISOString(),
      payload,
    });
    return id;
  }, []);

  const getOfflineQueue = useCallback(async () => {
    return await getAllOfflineSales();
  }, []);

  const discardQueuedSale = useCallback(async (id: string) => {
    await removeOfflineSale(id);
    await offlineSyncEngine.refreshPendingCount();
  }, []);

  const value: OfflineContextValue = {
    ...status,
    syncNow,
    cachePosData,
    loadCachedPosData,
    queueSaleForOffline,
    getOfflineQueue,
    discardQueuedSale,
  };

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

const defaultOfflineValue: OfflineContextValue = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncTime: null,
  lastError: null,
  syncedRecentlyCount: 0,
  syncNow: async () => ({ successCount: 0, failedCount: 0 }),
  cachePosData: async () => {},
  loadCachedPosData: async () => ({
    products: [],
    categories: [],
    customers: [],
    tables: [],
    settings: null,
    stockMap: {},
  }),
  queueSaleForOffline: async () => '',
  getOfflineQueue: async () => [],
  discardQueuedSale: async () => {},
};

export function useOffline() {
  const ctx = useContext(OfflineContext);
  return ctx || defaultOfflineValue;
}
