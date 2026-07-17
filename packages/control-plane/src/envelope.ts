// Response envelope helpers. Team-lead Ruling 1: the STRING-code form
// `{ code: "OK" | "ERROR", data, message }` is authoritative everywhere,
// matching the shipped dashboard's sendJson() and the CI smoke test. HTTP
// status carries the real signal (200 / 400 / 401 / 403 / 500).

export type Envelope = {
  code: "OK" | "ERROR"
  data: unknown
  message: string
}

export function ok(data: unknown, message = ""): Envelope {
  return { code: "OK", data, message }
}

export function err(message: string, data: unknown = null): Envelope {
  return { code: "ERROR", data, message }
}
