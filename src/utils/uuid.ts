export function generateUUIDv7(): string {
  const timestamp = Date.now().toString(16).padStart(12, '0');
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  random[0] = (random[0] & 0x0f) | 0x70;
  random[2] = (random[2] & 0x3f) | 0x80;
  const suffix = Array.from(random).map(value => value.toString(16).padStart(2, '0')).join('');
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-${suffix.slice(0, 4)}-${suffix.slice(4, 8)}-${suffix.slice(8)}`;
}
