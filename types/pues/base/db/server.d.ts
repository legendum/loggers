import type { Database } from "bun:sqlite";

export type DbConfig = {
  path?: string;
};

export type ResolvedDbConfig = {
  path: string;
};

export function readDbConfig(root: string): ResolvedDbConfig;
export function getDb(): Database;
export function resetDbForTesting(): void;
export function setDbRoot(root: string): void;
export function applyMigrations(db: Database, root: string): void;
export function applySchema(db: Database, root: string): void;
