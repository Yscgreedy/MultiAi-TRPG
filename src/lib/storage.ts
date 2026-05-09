import type { GameRepository } from "./storage/types";
import { isTauriRuntime } from "./storage/shared";
import { BrowserRepository } from "./storage/browser-repository";
import { SqliteRepository } from "./storage/sqlite-repository";

export type { GameRepository } from "./storage/types";
export { BrowserRepository } from "./storage/browser-repository";
export { SqliteRepository } from "./storage/sqlite-repository";

export function createRepository(): GameRepository {
  return isTauriRuntime() ? new SqliteRepository() : new BrowserRepository();
}
