declare module "better-sqlite3" {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement<BindParameters extends unknown[] = unknown[]> {
    run(...params: BindParameters): RunResult;
    get<Result = unknown>(...params: BindParameters): Result | undefined;
    all<Result = unknown>(...params: BindParameters): Result[];
  }

  export interface Transaction<Args extends unknown[], Result> {
    (...args: Args): Result;
  }

  export interface Database {
    exec(sql: string): Database;
    pragma(source: string): unknown;
    prepare<BindParameters extends unknown[] = unknown[]>(source: string): Statement<BindParameters>;
    transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): Transaction<Args, Result>;
    close(): void;
  }

  export interface DatabaseConstructor {
    new(path: string): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
