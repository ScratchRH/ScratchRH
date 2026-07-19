import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Foundry build artifacts live at the repo root, one level up from keeper/.
const OUT_DIR = path.resolve(__dirname, "../../out");

function loadAbi(contractFile: string, contractName: string) {
  const json = JSON.parse(readFileSync(path.join(OUT_DIR, contractFile, `${contractName}.json`), "utf8"));
  return json.abi;
}

export const scratchCoreAbi = loadAbi("ScratchCore.sol", "ScratchCore");
export const randomnessAbi = loadAbi("Randomness.sol", "Randomness");
