/// No-op until $SCRATCH is deployed. Once it exists, this will route the
/// token's transfer tax to wherever the flywheel design lands (buyback,
/// jackpot top-up, etc.) — not wired into index.ts yet since there's nothing
/// to watch.
export async function routeTax(): Promise<void> {}
