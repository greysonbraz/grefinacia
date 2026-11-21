import { nfceHostAllowed, parseNfceHtml, type NfceData } from '../domain/nfce';
import { isNative } from './platform';

/**
 * Abre o link público do QR da NFC-e (no Android, sem as travas de navegador) e lê a página. Se a Sefaz pedir
 * captcha, mudar o leiaute ou for de outro estado, devolve null: o app oferece abrir a nota no navegador.
 */
export async function fetchNfce(url: string): Promise<NfceData | null> {
  if (!isNative() || !nfceHostAllowed(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { Accept: 'text/html' }, signal: ctrl.signal });
    if (!res.ok) return null;
    return parseNfceHtml(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
