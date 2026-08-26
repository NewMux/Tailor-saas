export type InventorySearchRecord = { code: string; name: string; category: string; color: string | null; unit: string };

export function makeCustomerSearchInput(search: string) {
  return { search: search.trim() };
}

export function matchesInventorySearch(item: InventorySearchRecord, search: string) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [item.code, item.name, item.category, item.color || "", item.unit].some(value => value.toLowerCase().includes(term));
}
