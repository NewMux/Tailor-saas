export type OfflineSaleKind = "checkout" | "quickCheckout";

/** The signed-in account that queued a sale. Offline data is only ever used by that account. */
export type OfflineOwner = { organizationId: number; userId: number };

export type OfflineSaleRecord = {
  clientReference: string;
  owner?: OfflineOwner;
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

let currentOwner: OfflineOwner | null = null;

/** Set by the sync provider from the signed-in user; null while signed out or impersonating. */
export function setOfflineOwner(owner: OfflineOwner | null) {
  currentOwner = owner;
}

export function isOwnedBy(record: { owner?: OfflineOwner }, owner: OfflineOwner | null) {
  return Boolean(owner && record.owner && record.owner.organizationId === owner.organizationId && record.owner.userId === owner.userId);
}

/** Cached catalog/settings snapshots are per organization, never shared between shops. */
export function scopedSnapshotKey(key: string, owner: OfflineOwner | null) {
  return owner ? `org${owner.organizationId}:${key}` : null;
}

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
  if (!currentOwner) throw new Error("Offline sales are not available for this session.");
  const clientReference = typeof input.clientReference === "string" && input.clientReference ? input.clientReference : `offline-${Date.now()}-${crypto.randomUUID()}`;
  const record: OfflineSaleRecord = { clientReference, owner: currentOwner, kind, input: { ...input, clientReference }, queuedAt: Date.now() };
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

/** Queued sales that belong to someone else (or to no known account); kept, never replayed or deleted. */
export async function countForeignOfflineSales(): Promise<number> {
  return (await listAllOfflineSales()).filter(record => !isOwnedBy(record, currentOwner)).length;
}

export async function listOfflineSales(): Promise<OfflineSaleRecord[]> {
  return (await listAllOfflineSales()).filter(record => isOwnedBy(record, currentOwner));
}

async function listAllOfflineSales(): Promise<OfflineSaleRecord[]> {
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

/** Drops cached catalogs and settings (not unsynced sales), e.g. on sign-out. */
export async function clearOfflineSnapshots() {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>(resolve => {
    const transaction = database.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    transaction.objectStore(SNAPSHOT_STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  database.close();
}

export async function saveOfflineSnapshot<T>(rawKey: string, value: T) {
  const key = scopedSnapshotKey(rawKey, currentOwner);
  if (!key || typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    transaction.objectStore(SNAPSHOT_STORE_NAME).put({ key, value, savedAt: Date.now() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Offline snapshot could not be saved."));
  });
  database.close();
}

export async function readOfflineSnapshot<T>(rawKey: string): Promise<T | undefined> {
  const key = scopedSnapshotKey(rawKey, currentOwner);
  if (!key || typeof indexedDB === "undefined") return undefined;
  const database = await openDatabase();
  const record = await new Promise<{ value?: T } | undefined>((resolve, reject) => {
    const request = database.transaction(SNAPSHOT_STORE_NAME, "readonly").objectStore(SNAPSHOT_STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as { value?: T } | undefined);
    request.onerror = () => reject(request.error || new Error("Offline snapshot could not be read."));
  });
  database.close();
  return record?.value;
}
