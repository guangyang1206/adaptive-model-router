declare module "node:fs" {
  export function existsSync(path: string): boolean
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function readFileSync(path: string, encoding: "utf8"): string
  export function writeFileSync(path: string, data: string, options?: { encoding?: string; flag?: string }): void
  export function readdirSync(path: string): string[]
}

declare module "node:path" {
  export function join(...paths: string[]): string
  export function resolve(...paths: string[]): string
  export function dirname(path: string): string
}

declare module "node:process" {
  const process: {
    argv: string[]
    cwd(): string
    env: Record<string, string | undefined>
    exitCode?: number
  }
  export default process
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string
}

interface ImportMeta {
  url: string
}
