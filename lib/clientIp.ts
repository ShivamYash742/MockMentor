// The client's address as the hosting proxy saw it: x-real-ip when the proxy sets it (Vercel,
// nginx), otherwise the last x-forwarded-for entry — the one the nearest proxy appended. The first
// entry can be written by the caller on proxies that append, so it's never used.
// Null when there's no usable address: no header, or a loopback address (Next fills in the socket
// address when no proxy did, so local dev, or a same-host proxy that doesn't forward the client
// IP, looks like 127.0.0.1). IP limits are then skipped rather than putting every visitor into one
// shared bucket; per-identity limits still apply.
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
export function clientIp(req: Request): string | null {
  const realIp = req.headers.get('x-real-ip')?.trim();
  const forwarded = req.headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean);
  const ip = realIp || (forwarded?.length ? forwarded[forwarded.length - 1] : '');
  return ip && !LOOPBACK.test(ip) ? ip : null;
}
