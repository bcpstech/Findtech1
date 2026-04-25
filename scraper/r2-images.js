/**
 * scraper/r2-images.js
 * Descarga imágenes de tiendas y las sube a Cloudflare R2
 * Bucket: findtech-images
 *
 * Para dominios bloqueados (n1g.cl), enruta la descarga por el proxy CF Worker.
 */

const axios = require('axios');
const crypto = require('crypto');

const R2_ENDPOINT = process.env.R2_ENDPOINT || 'https://d51c60da1c778105ece9b7cfcc08451b.r2.cloudflarestorage.com';
const R2_BUCKET   = process.env.R2_BUCKET   || 'findtech-images';
const R2_KEY_ID   = process.env.R2_KEY_ID   || '';
const R2_SECRET   = process.env.R2_SECRET   || '';
const R2_PUBLIC   = process.env.R2_PUBLIC   || 'https://images.findtech.cl';

const PROXY_URL    = process.env.CF_PROXY_URL    || '';
const PROXY_SECRET = process.env.CF_PROXY_SECRET || '';

// Dominios que requieren proxy para descargar imágenes desde GitHub Actions
const PROXY_DOMAINS = ['n1g.cl', 'www.n1g.cl'];

// Cache para no re-subir imágenes ya procesadas en el mismo run
const _uploaded = new Set();

// ── Helpers de firma AWS-S3 para R2 ──────────────────────────────────────

function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data).digest(encoding);
}

function getSignedHeaders(method, key, contentType, bodyHash, date) {
  const dateShort = date.slice(0, 8);
  const region    = 'auto';
  const service   = 's3';
  const host      = new URL(R2_ENDPOINT).host;

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${date}\n`;
  const signedHeaders    = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n/${R2_BUCKET}/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;

  const credentialScope = `${dateShort}/${region}/${service}/aws4_request`;
  const stringToSign    = `AWS4-HMAC-SHA256\n${date}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${R2_SECRET}`, dateShort), region), service),
    'aws4_request'
  );
  const signature = hmac(signingKey, stringToSign, 'hex');

  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${R2_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': date,
    'x-amz-content-sha256': bodyHash,
    'Content-Type': contentType,
  };
}

// ── Upload a R2 ───────────────────────────────────────────────────────────

async function uploadToR2(buffer, key, contentType) {
  const date     = new Date().toISOString().replace(/[:-]/g, '').slice(0, 15) + 'Z';
  const bodyHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const headers  = getSignedHeaders('PUT', key, contentType, bodyHash, date);
  const url      = `${R2_ENDPOINT}/${R2_BUCKET}/${key}`;

  await axios.put(url, buffer, {
    headers,
    maxBodyLength: 10 * 1024 * 1024,
    timeout: 30000,
  });
  return `${R2_PUBLIC}/${key}`;
}

// ── Descarga con proxy automático para dominios bloqueados ────────────────

function needsProxy(sourceUrl) {
  try {
    const hostname = new URL(sourceUrl).hostname;
    return PROXY_DOMAINS.includes(hostname) && !!PROXY_URL;
  } catch { return false; }
}

function buildProxyUrl(sourceUrl) {
  // mode=image → Worker devuelve arrayBuffer binario en vez de texto
  return `${PROXY_URL}?url=${encodeURIComponent(sourceUrl)}&secret=${PROXY_SECRET}&mode=image`;
}

async function downloadImage(sourceUrl, retries = 2) {
  const viaProxy = needsProxy(sourceUrl);
  const fetchUrl = viaProxy ? buildProxyUrl(sourceUrl) : sourceUrl;

  let origin;
  try { origin = new URL(sourceUrl).origin; } catch { origin = ''; }

  const headers = viaProxy
    ? { 'User-Agent': 'Mozilla/5.0 FindTech/1.0' } // el Worker pone sus propios headers
    : {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9',
        'Cache-Control': 'no-cache',
        ...(origin ? { 'Referer': origin + '/' } : {}),
      };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(fetchUrl, {
        responseType: 'arraybuffer',
        timeout: 25000,
        headers,
        maxContentLength: 8 * 1024 * 1024,
        maxRedirects: 5,
      });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

// ── API pública ───────────────────────────────────────────────────────────

/**
 * Descarga sourceUrl (vía proxy si es necesario) y sube a R2.
 * Retorna URL pública de R2, o null si falla (el scraper usará la URL original).
 */
async function mirrorImage(sourceUrl, slug) {
  if (!sourceUrl || !R2_KEY_ID || !R2_SECRET) return null;

  const ext = sourceUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1]?.toLowerCase() || 'jpg';
  const key = `products/${slug}.${ext}`;

  if (_uploaded.has(key)) return `${R2_PUBLIC}/${key}`;

  try {
    const res = await downloadImage(sourceUrl);
    const buffer = Buffer.from(res.data);

    // Validar que recibimos datos de imagen reales
    const contentType = res.headers['content-type']?.split(';')[0]?.trim() || `image/${ext}`;
    if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
      console.warn(`[R2] Tipo inesperado "${contentType}" para ${sourceUrl} — saltando`);
      return null;
    }
    if (buffer.length < 500) {
      console.warn(`[R2] Imagen vacía (${buffer.length}B) para ${sourceUrl} — saltando`);
      return null;
    }

    const publicUrl = await uploadToR2(buffer, key, contentType);
    _uploaded.add(key);
    return publicUrl;

  } catch (err) {
    const reason = err.code === 'ECONNABORTED' ? 'timeout' : err.message;
    console.warn(`[R2] Error mirroring ${sourceUrl}: ${reason}`);
    return null; // fallback a imagen original — el scraping continúa igual
  }
}

module.exports = { mirrorImage };
