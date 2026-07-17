// Hand-written Node built-in type shims for @adaptive-router/control-plane.
//
// Mirrors the convention in packages/dashboard/src/node-shims.d.ts: we do NOT
// depend on @types/node. Only the `node:*` surface actually used by the
// control-plane is declared here. better-auth and postgres ship their own
// .d.ts, so those need no shim; skipLibCheck (tsconfig.base.json) keeps their
// internal types from blocking our build.

declare module "node:http" {
  export type IncomingMessage = {
    url?: string
    method?: string
    headers: Record<string, string | string[] | undefined>
    on(event: "data", cb: (chunk: unknown) => void): void
    on(event: "end", cb: () => void): void
    on(event: "error", cb: (err: Error) => void): void
  }
  export type ServerResponse = {
    statusCode: number
    setHeader(name: string, value: string | string[]): void
    getHeader(name: string): string | number | string[] | undefined
    end(data?: string): void
    writeHead(status: number, headers?: Record<string, string | string[]>): void
  }
  export type Server = {
    close(callback?: (error?: Error) => void): void
  }
  export function createServer(
    listener: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  ): Server & { listen(port: number, host: string, callback?: () => void): void }
}

declare module "node:crypto" {
  export function randomBytes(size: number): { toString(enc: "hex" | "base64url"): string }
  export function createHash(algo: "sha256"): {
    update(data: string): { digest(enc: "hex"): string }
  }
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean
}

declare module "node:path" {
  export function join(...parts: string[]): string
  export function dirname(path: string): string
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string
}

declare module "node:fs" {
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: "utf8"): string
}

// Minimal process surface. `process.argv` lets server.ts detect direct exec.
declare const process: {
  env: Record<string, string | undefined>
  argv: string[]
  exit(code?: number): never
}

// import.meta.url is provided by ES module output; declare for TS under the
// hand-shim regime (no @types/node ImportMeta augmentation available).
interface ImportMeta {
  url: string
}

// node-postgres (`pg`) minimal shim. pg does NOT ship its own types (they live
// in @types/pg), and we avoid @types/* per the hand-shim convention. We only
// construct a Pool and end() it; Better-Auth consumes the Pool internally via
// `.connect()`/`.query()` (its own detection checks `"connect" in db`), so we
// declare enough of the node-postgres Pool surface for that handoff to typecheck.
declare module "pg" {
  export type PoolConfig = {
    connectionString?: string
    max?: number
    host?: string
    port?: number
    user?: string
    password?: string
    database?: string
    ssl?: boolean | Record<string, unknown>
  }
  export type QueryResult<R = Record<string, unknown>> = {
    rows: R[]
    rowCount: number
  }
  export type PoolClient = {
    query(text: string, values?: unknown[]): Promise<QueryResult>
    release(err?: boolean | Error): void
  }
  export class Pool {
    constructor(config?: PoolConfig)
    connect(): Promise<PoolClient>
    query(text: string, values?: unknown[]): Promise<QueryResult>
    end(): Promise<void>
    on(event: string, listener: (...args: unknown[]) => void): this
  }
}
