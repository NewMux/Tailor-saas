export type OfflineSaleKind = "checkout" | "quickCheckout";

export type OfflineSaleRecord = {
  clientReference: string;
  kind: OfflineSaleKind;
  input: Record<string, unknown>;
  queuedAt: number;
};

export type OfflineCatalogItem = {
  id: number;
  sku: string;
  name: string;
  category: string;
  description: string | null;
  unitPrice: string;
  inventoryItemId: number | null;
  defaultFabricMeters: string | null;
  isActive: boolean;
  inventory: {
    id: number;
    code: string;
    name: string;
    quantity: string;
    unit: string;
    isActive: boolean;
  } | null;
};

const DB_NAME = "al-hussam-erp-offline";
const SALES_STORE_NAME = "sales";
const SNAPSHOT_STORE_NAME = "snapshots";
const DB_VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SALES_STORE_NAME)) database.createObjectStore(SALES_STORE_NAME, { keyPath: "clientReference" });
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) database.createObjectStore(SNAPSHOT_STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline storage is unavailable."));
  });
}

export async function enqueueOfflineSale(kind: OfflineSaleKind, input: Record<string, unknown>) {
  const clientReference = typeof input.clientReference === "string" && input.clientReference ? input.clientReference : `offline-${Date.now()}-${crypto.randomUUID()}`;
  const record: OfflineSaleRecord = { clientReference, kind, input: { ...input, clientReference }, queuedAt: Date.now() };
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SALES_STORE_NAME, "readwrite");
    transaction.objectStore(SALES_STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Offline sale could not be queued."));
  });
  database.close();
  return record;
}

export async function listOfflineSales(): Promise<OfflineSaleRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  const records = await new Promise<OfflineSaleRecord[]>((resolve, reject) => {
    const request = database.transaction(SALES_STORE_NAME, "readonly").objectStore(SALES_STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as OfflineSaleRecord[]).sort((a, b) => a.queuedAt - b.queuedAt));
    request.onerror = () => reject(request.error || new Error("Offline sales could not be read."));
  });
  database.close();
  return records;
}

export async function removeOfflineSale(clientReference: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SALES_STORE_NAME, "readwrite");
    transaction.objectStore(SALES_STORE_NAME).delete(clientReference);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Queued sale could not be removed."));
  });
  database.close();
}

export async function saveOfflineSnapshot<T>(key: string, value: T) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    transaction.objectStore(SNAPSHOT_STORE_NAME).put({ key, value, savedAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Offline snapshot could not be saved."));
  });
  database.close();
}

export async function readOfflineSnapshot<T>(key: string): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const database = await openDatabase();
  const record = await new Promise<{ value?: T } | undefined>((resolve, reject) => {
    const request = database.transaction(SNAPSHOT_STORE_NAME, "readonly").objectStore(SNAPSHOT_STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as { value?: T } | undefined);
    request.onerror = () => reject(request.error || new Error("Offline snapshot could not be read."));
  });
  database.close();
  return record?.value;
}
