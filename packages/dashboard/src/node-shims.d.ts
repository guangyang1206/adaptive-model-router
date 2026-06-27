declare module "node:http" {
  export type IncomingMessage = {
    url?: string
    method?: string
  }

  export type ServerResponse = {
    statusCode: number
    setHeader(name: string, value: string): void
    end(data?: string): void
  }

  export type Server = {
    close(callback?: (error?: Error) => void): void
  }

  export function createServer(
    listener: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  ): Server & { listen(port: number, host: string, callback?: () => void): void }
}
