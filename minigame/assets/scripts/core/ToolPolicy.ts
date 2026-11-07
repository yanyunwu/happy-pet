import type { EntryId } from './OnlineClient';

export interface ToolAvailability {
  uses: number;
  source: 'free' | 'bag' | 'share' | null;
  canShare: boolean;
}

/** Each tool proceeds through free, one campaign bag item, then one share. */
export function toolAvailability(
  entry: EntryId,
  free: number,
  bag: number,
  bagUsed: boolean,
  shared: boolean,
  shareUses: number,
): ToolAvailability {
  if (shared) return { uses: shareUses, source: shareUses > 0 ? 'share' : null, canShare: false };
  const bagAvailable = entry === 'campaign' && !bagUsed && bag > 0;
  const uses = free + (bagAvailable ? 1 : 0);
  return {
    uses,
    source: free > 0 ? 'free' : bagAvailable ? 'bag' : null,
    canShare: uses === 0,
  };
}
