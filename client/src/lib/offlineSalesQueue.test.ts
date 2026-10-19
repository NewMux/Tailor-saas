import { describe, expect, it } from "vitest";
import { isOwnedBy, scopedSnapshotKey, type OfflineOwner } from "./offlineSalesQueue";

const alice: OfflineOwner = { organizationId: 1, userId: 10 };
const bob: OfflineOwner = { organizationId: 2, userId: 20 };

describe("offline queue ownership", () => {
  it("replays a record only for the account that queued it", () => {
    expect(isOwnedBy({ owner: alice }, alice)).toBe(true);
    expect(isOwnedBy({ owner: alice }, bob)).toBe(false);
    expect(isOwnedBy({ owner: alice }, { organizationId: 1, userId: 11 })).toBe(false);
  });

  it("never claims records without an owner, or when nobody is signed in", () => {
    expect(isOwnedBy({}, alice)).toBe(false);
    expect(isOwnedBy({ owner: alice }, null)).toBe(false);
  });

  it("keeps cached catalogs separate per organization", () => {
    expect(scopedSnapshotKey("services", alice)).not.toBe(scopedSnapshotKey("services", bob));
    expect(scopedSnapshotKey("services", null)).toBeNull();
  });
});
