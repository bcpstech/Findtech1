/**
 * scraper/icecat.js
 * Busca imágenes y specs oficiales en Open Icecat por marca + nombre de producto
 * Cuenta: BCPSTECH (Open Icecat gratuito)
 */

const axios = require('axios');

const ICECAT_USER = process.env.ICECAT_USER || 'BCPSTECH';
const ICECAT_API  = 'https://live.icecat.us/api';

// Cache en memoria para no repetir búsquedas en el mismo run
const _cache = new Map();

// Marcas conocidas para normalizar
const BRAND_MAP = {
  'amd':        'AMD',
  'intel':      'Intel',
  'nvidia':     'Nvidia',
  'asus':       'Asus',
  'msi':        'MSI',
  'gigabyte':   'Gigabyte',
  'asrock':     'ASRock',
  'corsair':    'Corsair',
  'kingston':   'Kingston',
  'crucial':    'Crucial',
  'gskill':     'G.Skill',
  'g.skill':    'G.Skill',
  'samsung':    'Samsung',
  'western digital': 'Western Digital',
  'wd':         'Western Digital',
  'seagate':    'Seagate',
  'noctua':     'Noctua',
  'cooler master': 'Cooler Master',
  'nzxt':       'NZXT',
  'lian li':    'Lian Li',
  'fractal':    'Fractal Design',
  'seasonic':   'Seasonic',
  'evga':       'EVGA',
  'zotac':      'Zotac',
  'sapphire':   'Sapphire',
  'powercolor': 'PowerColor',
  'xfx':        'XFX',
  'thermaltake':'Thermaltake',
  'be quiet':   'be quiet!',
  'deepcool':   'Deepcool',
  'arctic':     'Arctic',
  'hyperx':     'HyperX',
  'teamgroup':  'TeamGroup',
  'patriot':    'Patriot',
};

/**
 * Extrae la marca del nombre del producto
 */
function extractBrandFromName(name) {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(BRAND_MAP)) {
    if (lower.startsWith(key) || lower.includes(' ' + key + ' ') || lower.includes(' ' + key)) {
      return val;
    }
  }
  // Tomar la primera palabra como marca
  return name.split(/\s+/)[0];
}

/**
 * Limpia el nombre del producto para la búsqueda
 * Remueve la marca del inicio y caracteres especiales
 */
function cleanProductName(name, brand) {
  let clean = name;
  // Remover marca del inicio
  if (brand) {
    const brandLower = brand.toLowerCase();
    const nameLower = clean.toLowerCase();
    if (nameLower.startsWith(brandLower)) {
      clean = clean.slice(brand.length).trim();
    }
  }
  // Remover caracteres que confunden la búsqueda
  clean = clean
    .replace(/\s+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .trim()
    .slice(0, 80); // Limitar largo
  return clean;
}

/**
 * Busca producto en Icecat y retorna imagen + specs
 * @param {string} name - Nombre completo del producto
 * @param {string} brand - Marca del producto
 * @returns {Promise<{imageUrl: string|null, specs: object, description: string|null}>}
 */
async function fetchIcecatData(name, brand) {
  if (!name) return { imageUrl: null, specs: {}, description: null };

  const cacheKey = `${brand}::${name}`.toLowerCase();
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  const normalizedBrand = BRAND_MAP[brand?.toLowerCase()] || brand || extractBrandFromName(name);
  const productName = cleanProductName(name, normalizedBrand);

  const url = `${ICECAT_API}/?UserName=${ICECAT_USER}&Language=ES&Brand=${encodeURIComponent(normalizedBrand)}&ProductName=${encodeURIComponent(productName)}`;

  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FindTech.cl/1.0',
      }
    });

    const data = res.data?.data;
    if (!data) {
      _cache.set(cacheKey, { imageUrl: null, specs: {}, description: null });
      return { imageUrl: null, specs: {}, description: null };
    }

    // Imagen de alta calidad
    const imageUrl = data.Image?.HighPic
                  || data.Image?.LowPic
                  || data.Image?.ThumbPic
                  || null;

    // Specs técnicas
    const specs = {};
    if (data.FeaturesGroups) {
      for (const group of data.FeaturesGroups) {
        for (const feat of group.Features || []) {
          const key   = feat.Feature?.Name?.Value || feat.Feature?.Measure?.Signs?.Sign?.[0]?.Value;
          const value = feat.LocalValue || feat.Value;
          if (key && value) specs[key] = value;
        }
      }
    }

    // Descripción corta
    const description = data.ShorSummaryDescription
                     || data.LongSummaryDescription
                     || null;

    const result = { imageUrl, specs, description };
    _cache.set(cacheKey, result);
    return result;

  } catch (err) {
    // No loguear errores 404 (producto no encontrado) para no llenar los logs
    if (err.response?.status !== 404) {
      console.warn(`[Icecat] Error buscando "${name}": ${err.message}`);
    }
    const empty = { imageUrl: null, specs: {}, description: null };
    _cache.set(cacheKey, empty);
    return empty;
  }
}

module.exports = { fetchIcecatData, extractBrandFromName };
