import {createHash} from 'node:crypto';

export const PORCHLIGHT_EXTENSION_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1T0jtVJgbkVaErcDR9x+g1Zz2MUY3kVuJYXthlPd2nH9PqdiEVqDBMeP4tI0wnXO1CMiX6MtuUbXfBiEP6+ToksjpaTNKuxy0FBh+/6M6SDqA3oVB71yUPXBILQPko/mgkXCza41HFCFC8Jc8NIgKoEaujUVJA8HXuhpCUAwmUjGmKyoR4c7HD4s8hn/1ahLTre6d10mqKsjpnt3mtNTfXw0M+JflGmbNvbItQZRoG6pc0FloE1y8sM6ygoUCvJ3l94IwGNrV0ENZ4W0mCqG1eOtsYK9Fuwx8F1/MKJ3r2wEfAblZ/LE+K4tCmn/AyD8uNuoNIlx9KifoWod3qFQ3wIDAQAB';

export function chromeExtensionIdFromPublicKey(publicKey = PORCHLIGHT_EXTENSION_PUBLIC_KEY) {
  const digest = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest().subarray(0, 16);
  return [...digest].flatMap((byte) => [byte >> 4, byte & 15]).map((nibble) => String.fromCharCode(97 + nibble)).join('');
}

export const PORCHLIGHT_EXTENSION_ID = chromeExtensionIdFromPublicKey();
export const PORCHLIGHT_EXTENSION_ORIGIN = `chrome-extension://${PORCHLIGHT_EXTENSION_ID}`;
