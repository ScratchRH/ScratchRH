import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface KeeperState {
  lastProcessedBlock: string; // bigint serialized as decimal string
  pendingTicketIds: string[]; // bigint[] serialized as decimal strings
  warnedExpiredTicketIds: string[];
}

export function loadState(stateFile: string): KeeperState | null {
  if (!existsSync(stateFile)) return null;
  return JSON.parse(readFileSync(stateFile, "utf8"));
}

export function saveState(stateFile: string, state: KeeperState): void {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
