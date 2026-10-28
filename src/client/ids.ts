/** Short random IDs with a readable prefix: run_…, req_…, chat_…. */
export function newId(prefix: 'run' | 'req' | 'chat'): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
}
