import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

/** Opens an app database after ensuring SQLite's parent directory exists. */
export function openSQLiteDatabase(file: string): DatabaseSync {
  mkdirSync(path.dirname(file), { recursive: true })
  return new DatabaseSync(file)
}
