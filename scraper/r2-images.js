/**
 * scraper/r2-images.js
 * Descarga imágenes de tiendas y las sube a Cloudflare R2
 * Bucket: findtech-images
 */

const axios = require('axios');
const crypto = require('crypto');

const R2_ENDPOINT  = process.env.R2_ENDPOINT  || 'https://d51c60da1c778105ece9b7cfcc08451b.r2.cloudflarestorage.com';
const R2_BUCKET    = process.env.R2_BUCKET    || 'findtech-images';
const R2_KEY_ID    = process.env.R2_KEY_ID    || '';
const R2_SECRET    = process.env.R2_SECRET    || '';
const R2_PUBLIC    = process.env.R2_PUBLIC    || 'https://images.findtech.cl'; // dominio público del bucket

// Cache para no re-subir imágenes ya procesadas en el mismo run
const _uploaded = new Set();

/**
 * Genera firma AWS-S3 compatible para R2
 */
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

  const credentialScope  = `${dateShort}/${region}/${service}/aws4_request`;
  const stringToSign     = `AWS4-HMAC-SHA256\n${date}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

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

/**
 * Sube un buffer de imagen a R2
 */
async function uploadToR2(buffer, key, contentType) {
  const date     = new Date().toISOString().replace(/[:-]/g, '').slice(0, 15) + 'Z';
  const bodyHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const headers  = getSignedHeaders('PUT', key, contentType, bodyHash, date);
  const url      = `${R2_ENDPOINT}/${R2_BUCKET}/${key}`;

  await axios.put(url, buffer, { headers, maxBodyLength: 10 * 1024 * 1024 });
  return `${R2_PUBLIC}/${key}`;
}

/**
 * Descarga una imagen de una URL y la sube a R2
 * Retorna la URL pública de R2 o null si falla
 */
async function mirrorImage(sourceUrl, slug) {
  if (!sourceUrl || !R2_KEY_ID || !R2_SECRET) return null;
  if (_uploaded.has(slug)) return `${R2_PUBLIC}/${slug}`;

  try {
    // Determinar extensión
    const ext = sourceUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1]?.toLowerCase() || 'jpg';
    const key = `products/${slug}.${ext}`;
    const publicUrl = `${R2_PUBLIC}/${key}`;

    // Descargar imagen
    const res = await axios.get(sourceUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FindTech/1.0)',
        'Referer': new URL(sourceUrl).origin,
      },
      maxContentLength: 5 * 1024 * 1024, // máx 5MB por imagen
    });

    const buffer      = Buffer.from(res.data);
    const contentType = res.headers['content-type'] || `image/${ext}`;

    // Subir a R2
    await uploadToR2(buffer, key, contentType);
    _uploaded.add(slug);
    return publicUrl;

  } catch (err) {
    console.warn(`[R2] Error mirroring ${sourceUrl}: ${err.message}`);
    return null; // fallback a imagen original
  }
}

module.exports = { mirrorImage };
