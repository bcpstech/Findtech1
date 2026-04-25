/**
 * scraper/r2-images.js
 * Descarga imágenes de tiendas y las sube a Cloudflare R2
 * Bucket: findtech-images
 */

const axios = require('axios');
const crypto = require('crypto');

const R2_ENDPOINT = process.env.R2_ENDPOINT || 'https://d51c60da1c778105ece9b7cfcc08451b.r2.cloudflarestorage.com';
const R2_BUCKET   = process.env.R2_BUCKET   || 'findtech-images';
const R2_KEY_ID   = process.env.R2_KEY_ID   || '';
const R2_SECRET   = process.env.R2_SECRET   || '';
const R2_PUBLIC   = process.env.R2_PUBLIC   || 'https://images.findtech.cl';

// Cache para no re-subir imágenes ya procesadas en el mismo run
const _uploaded = new Set();

// ── Firma AWS-S3 compatible para R2 ──────────────────────────────────────

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
    timeout: 30000, // 30s para el upload a R2
  });
  return `${R2_PUBLIC}/${key}`;
}

// ── Descarga con reintentos ───────────────────────────────────────────────

async function downloadImage(sourceUrl, retries = 3) {
  let origin;
  try { origin = new URL(sourceUrl).origin; } catch { origin = ''; }

  // Headers que imitan un navegador real descargando una imagen
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'es-CL,es;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    ...(origin ? { 'Referer': origin + '/' } : {}),
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 25000,          // FIX: 25s en vez de 10s — n1g.cl es lento
        headers,
        maxContentLength: 8 * 1024 * 1024, // máx 8MB por imagen
        maxRedirects: 5,
      });
      return res;
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) throw err;

      // Esperar antes de reintentar (backoff exponencial)
      const wait = attempt * 3000;
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// ── API pública ───────────────────────────────────────────────────────────

/**
 * Descarga una imagen de sourceUrl y la sube a R2.
 * Retorna la URL pública de R2, o null si falla (fallback a imagen original).
 */
async function mirrorImage(sourceUrl, slug) {
  if (!sourceUrl || !R2_KEY_ID || !R2_SECRET) return null;
  if (_uploaded.has(slug)) return `${R2_PUBLIC}/products/${slug}.jpg`; // devuelve cached

  try {
    // Determinar extensión desde la URL
    const ext = sourceUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1]?.toLowerCase() || 'jpg';
    const key = `products/${slug}.${ext}`;
    const publicUrl = `${R2_PUBLIC}/${key}`;

    // Descargar con reintentos
    const res = await downloadImage(sourceUrl);

    const buffer      = Buffer.from(res.data);
    const contentType = res.headers['content-type']?.split(';')[0] || `image/${ext}`;

    // Validar que recibimos algo parecido a una imagen
    if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
      console.warn(`[R2] Tipo inesperado ${contentType} para ${sourceUrl} — saltando`);
      return null;
    }
    if (buffer.length < 500) {
      console.warn(`[R2] Imagen demasiado pequeña (${buffer.length}B) — saltando`);
      return null;
    }

    await uploadToR2(buffer, key, contentType);
    _uploaded.add(slug);
    return publicUrl;

  } catch (err) {
    // Log breve sin cortar el scraping — la imagen original se usará como fallback
    const reason = err.code === 'ECONNABORTED' ? 'timeout' : err.message;
    console.warn(`[R2] Error mirroring ${sourceUrl}: ${reason}`);
    return null;
  }
}

module.exports = { mirrorImage };
