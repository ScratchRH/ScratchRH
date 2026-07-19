// Client-side "logged in" feel without any account or wallet connect: we
// just remember the last address someone looked themselves up with, the
// same way DeBank/Zapper remember a "watched" address. Nothing sensitive
// is stored — it's a public address, same as typing it into a block
// explorer.
const STORAGE_KEY = "scratch:address";

export function getRememberedAddress(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberAddress(address: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, address);
  } catch {
    // localStorage unavailable (private browsing, storage full, etc.) - just skip remembering.
  }
}
