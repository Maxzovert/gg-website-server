import { query } from '../config/db.js';
import { getS3PublicUrl } from '../config/s3.js';
import { landingSitemapPaths } from '../seo/landingPaths.js';

const PRODUCT_IMAGE_KEYS = ['image1', 'image2', 'image3', 'image4', 'image5', 'image6', 'image7', 'image8'];
const VIDEO_URL_PATTERN = /\.(mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i;

function isVideoMediaUrl(url) {
  if (!url) return false;
  const base = String(url).trim().split(/[?#]/)[0];
  return VIDEO_URL_PATTERN.test(base) || /\/videos?\//i.test(base);
}

function firstImageFromRow(imagesData) {
  if (!imagesData || typeof imagesData !== 'object') return null;
  for (const key of PRODUCT_IMAGE_KEYS) {
    const raw = imagesData[key];
    if (raw == null) continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && typeof value === 'object') {
      const nested = value.url ?? value.image_url ?? value.key ?? value.path ?? value.src;
      if (nested) {
        const resolved = getS3PublicUrl(String(nested)) || String(nested);
        if (!isVideoMediaUrl(resolved)) return resolved;
      }
      continue;
    }
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'null') continue;
    const resolved = getS3PublicUrl(text) || text;
    if (!isVideoMediaUrl(resolved)) return resolved;
  }
  return null;
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadSitemapData() {
  const productsRes = await query(
    `SELECT p.slug, p.updated_at, p.created_at,
            (
              SELECT row_to_json(pi.*)
              FROM product_images pi
              WHERE pi.product_id = p.id
              LIMIT 1
            ) AS images
     FROM products p
     WHERE p.status = 'active'
       AND p.slug IS NOT NULL
       AND TRIM(p.slug) <> ''
     ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC`,
    [],
  );

  const products = (productsRes.rows || []).map((row) => ({
    slug: row.slug,
    lastmod: toIsoDate(row.updated_at || row.created_at),
    image: firstImageFromRow(row.images),
  }));

  const blogsRes = await query(
    `SELECT slug, updated_at, published_at, created_at,
            COALESCE(hero_image_url, header_image_url) AS image
     FROM blog_posts
     WHERE is_published = TRUE
       AND slug IS NOT NULL
       AND TRIM(slug) <> ''
     ORDER BY COALESCE(published_at, created_at) DESC`,
    [],
  );

  const blogs = (blogsRes.rows || []).map((row) => ({
    slug: row.slug,
    lastmod: toIsoDate(row.updated_at || row.published_at || row.created_at),
    image: row.image || null,
  }));

  return { products, blogs };
}

/**
 * Public SEO payload for sitemap generation (Worker or build tools).
 * GET /api/seo/sitemap-urls
 */
export const getSitemapUrls = async (_req, res) => {
  try {
    const data = await loadSitemapData();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getSitemapUrls]', error?.message || error);
    return res.status(500).json({
      success: false,
      error: 'Failed to build sitemap URL list',
    });
  }
};

/**
 * XML sitemap (for nginx / non-Worker hosts).
 * GET /api/seo/sitemap.xml
 */
export const getSitemapXml = async (_req, res) => {
  try {
    const site = String(process.env.SITE_URL || 'https://www.gawriganga.com').replace(/\/+$/, '');
    const { products, blogs } = await loadSitemapData();
    const today = new Date().toISOString().slice(0, 10);
    const staticPaths = [
      '/',
      '/sprays',
      '/rudraksha',
      '/tulsimala',
      '/rashi',
      '/accessories',
      '/purpose-products',
      '/combos',
      '/products',
      '/about',
      '/blog',
      '/contact',
      '/corporate-bulk-orders',
      '/terms-of-service',
      '/refund-cancellation',
      '/terms-and-conditions',
      '/shipping-policy',
      '/privacy-policy',
      '/sprays/amrat-bindu',
      '/sprays/maitri',
      '/sprays/chakra-balance',
      '/sprays/shuddhi',
    ];
    staticPaths.push(...landingSitemapPaths());

    const urls = [
      ...staticPaths.map((path) => ({
        loc: `${site}${path === '/' ? '/' : path}`,
        lastmod: today,
        image: null,
      })),
      ...products.map((p) => ({
        loc: `${site}/product/${p.slug}`,
        lastmod: p.lastmod,
        image: p.image,
      })),
      ...blogs.map((b) => ({
        loc: `${site}/blog/${b.slug}`,
        lastmod: b.lastmod,
        image: b.image,
      })),
    ];

    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
      '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
      ...urls.map((u) => {
        const imageBlock = u.image
          ? `\n    <image:image>\n      <image:loc>${xmlEscape(u.image)}</image:loc>\n    </image:image>`
          : '';
        return `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>\n    <lastmod>${xmlEscape(u.lastmod)}</lastmod>${imageBlock}\n  </url>`;
      }),
      '</urlset>',
    ].join('\n');

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(body);
  } catch (error) {
    console.error('[getSitemapXml]', error?.message || error);
    return res.status(500).type('text/plain').send('Failed to build sitemap');
  }
};
