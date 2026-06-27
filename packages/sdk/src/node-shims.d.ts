declare module "node:fs/promises" {
  export function appendFile(path: string, data: string, options?: { encoding?: string }): Promise<void>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  export function readFile(path: string, options?: { encoding?: BufferEncoding }): Promise<string>
  export function writeFile(path: string, data: string, options?: { encoding?: string }): Promise<void>
}

declare module "node:path" {
  export function dirname(path: string): string
}

type BufferEncoding = "utf8"
