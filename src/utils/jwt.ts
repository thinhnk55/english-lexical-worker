export interface JwtPayload {
  sub: string;
  type: 'access' | 'refresh';
  role: string;
  email: string;
  iat: number;
  exp: number;
  nbf: number;
}

export async function verifyAccessToken(token: string, publicKeyPem: string): Promise<{ valid: boolean; payload?: JwtPayload }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };
    const payload = JSON.parse(atob(toBase64(parts[1]))) as JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.type !== 'access' || (payload.exp && now >= payload.exp) || (payload.nbf && now < payload.nbf)) return { valid: false };
    const pem = publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
    const key = await crypto.subtle.importKey('spki', decodeBase64(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64(toBase64(parts[2])), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return valid ? { valid: true, payload } : { valid: false };
  } catch {
    return { valid: false };
  }
}

function toBase64(value: string): string {
  return value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
