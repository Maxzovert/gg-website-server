import { query } from '../config/db.js';

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPaise(value) {
  return Math.round(toNumber(value, 0) * 100);
}

function meetsMinimumOrder(subtotal, minimum) {
  const min = toNumber(minimum, 0);
  const sub = toNumber(subtotal, 0);
  // If minimum is whole-rupee (common case), align with UI rounded rupee display.
  if (Number.isInteger(min)) {
    return Math.round(sub) >= min;
  }
  return toPaise(sub) >= toPaise(min);
}

export async function buildCartContext(items) {
  const normalizedItems = Array.isArray(items)
    ? items
        .map((item) => ({
          product_id: String(item?.product_id ?? item?.id ?? '').trim(),
          quantity: Math.max(1, Number(item?.quantity || 1)),
          product_price: Math.max(0, toNumber(item?.product_price ?? item?.price, 0)),
        }))
        .filter((item) => item.product_id.length > 0)
    : [];

  const productIds = [...new Set(normalizedItems.map((item) => item.product_id))];
  if (productIds.length === 0 || normalizedItems.length === 0) {
    return { subtotal: 0, productIds: [], categoryNames: [] };
  }

  const placeholders = productIds.map((_, i) => `$${i + 1}`).join(', ');
  const productsRes = await query(
    `SELECT p.id AS product_id, p.price AS product_price, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id IN (${placeholders})`,
    productIds,
  );
  const productPriceMap = new Map(
    (productsRes.rows || []).map((row) => [String(row.product_id), toNumber(row.product_price, 0)]),
  );

  // Subtotal for coupon eligibility should be based on authoritative DB product price.
  // If a product is missing in DB result, fallback to client-provided price for resilience.
  const subtotal = normalizedItems.reduce((sum, item) => {
    const dbPrice = productPriceMap.get(item.product_id);
    const unitPrice = Number.isFinite(dbPrice) ? dbPrice : item.product_price;
    return sum + unitPrice * item.quantity;
  }, 0);

  const categoryNames = [
    ...new Set(
      (productsRes.rows || [])
        .map((row) => String(row.category_name || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  return { subtotal, productIds, categoryNames };
}

function isCouponActive(coupon) {
  const now = Date.now();
  const start = coupon.start_date ? new Date(coupon.start_date).getTime() : null;
  const end = coupon.expiry_date ? new Date(coupon.expiry_date).getTime() : null;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return String(coupon.status || '').toLowerCase() === 'active';
}

function intersects(a, b) {
  const setB = new Set(b);
  return a.some((x) => setB.has(x));
}

const ALL_CATEGORY_SENTINELS = new Set([
  'all',
  'all categories',
  'all category',
  'any',
  'everywhere',
  '*',
  'every',
]);

function tokenFromArrayItem(item) {
  if (item == null) return '';
  if (typeof item === 'object' && !Array.isArray(item)) {
    return String(item.name || item.label || item.category || item.id || '').trim();
  }
  return String(item).trim();
}

function parseStringArrayField(value) {
  if (Array.isArray(value)) {
    return value.map(tokenFromArrayItem).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(tokenFromArrayItem).filter(Boolean);
      }
      if (parsed && typeof parsed === 'object') {
        const token = tokenFromArrayItem(parsed);
        return token ? [token] : [];
      }
    } catch {
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed
          .slice(1, -1)
          .split(',')
          .map((part) => part.replace(/^"|"$/g, '').trim())
          .filter(Boolean);
      }
      return trimmed.split(',').map((part) => part.trim()).filter(Boolean);
    }
  }
  return [];
}

function categoryVariants(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return [];
  if (normalized === 'rudraksha' || normalized === 'rudrakshas') {
    return ['rudraksha', 'rudrakshas'];
  }
  if (normalized === 'tulsi mala' || normalized === 'tulsimala') {
    return ['tulsi mala', 'tulsimala'];
  }
  if (normalized === 'accessories' || normalized === 'accessory') {
    return ['accessories', 'accessory'];
  }
  return [normalized];
}

function joinCategoryList(names) {
  const list = (names || []).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

async function getCategoryLookups() {
  const res = await query('SELECT id::text AS id, name FROM categories');
  const byId = new Map();
  const byNameLower = new Map();
  (res.rows || []).forEach((row) => {
    const id = String(row.id || '').trim();
    const name = String(row.name || '').trim();
    if (id) byId.set(id, name);
    if (name) byNameLower.set(name.toLowerCase(), name);
  });
  return { byId, byNameLower };
}

function resolveApplicableCategories(raw, lookups) {
  const parsed = parseStringArrayField(raw);
  const display = [];
  const matchKeys = [];
  const seen = new Set();

  for (const item of parsed) {
    const token = String(item || '').trim();
    if (!token) continue;
    const lower = token.toLowerCase();
    if (ALL_CATEGORY_SENTINELS.has(lower)) continue;

    const resolvedName =
      lookups?.byId?.get(token) ||
      lookups?.byNameLower?.get(lower) ||
      token;
    const key = String(resolvedName).trim().toLowerCase();
    if (!key || seen.has(key)) continue;

    seen.add(key);
    display.push(resolvedName);
    matchKeys.push(key);
  }

  return {
    display,
    matchKeys,
    appliesToAll: display.length === 0,
  };
}

function categoriesMatch(cartCategoryNames, applicableCategories) {
  if (applicableCategories.length === 0) return true;
  const cartSet = new Set(cartCategoryNames.flatMap((c) => categoryVariants(c)));
  return applicableCategories.some((cat) =>
    categoryVariants(cat).some((variant) => cartSet.has(variant)),
  );
}

export async function evaluateCouponForCart({ code, items, userId = null }) {
  const couponCode = normalizeCode(code);
  if (!couponCode) {
    return { ok: false, status: 400, message: 'Coupon code is required' };
  }

  const couponRes = await query('SELECT * FROM coupons WHERE UPPER(code) = $1 LIMIT 1', [couponCode]);
  const coupon = couponRes.rows?.[0];
  if (!coupon) {
    return { ok: false, status: 404, message: 'Coupon not found' };
  }

  if (!isCouponActive(coupon)) {
    return { ok: false, status: 400, message: 'Coupon is inactive or expired' };
  }

  const { subtotal, productIds, categoryNames } = await buildCartContext(items);

  const minAmount = toNumber(coupon.minimum_order_amount, 0);
  if (!meetsMinimumOrder(subtotal, minAmount)) {
    return {
      ok: false,
      status: 400,
      message: `Minimum order amount for this coupon is ₹${minAmount.toLocaleString('en-IN')}`,
    };
  }

  const applicableProductIds = parseStringArrayField(coupon.applicable_product_ids)
    .map((id) => String(id).trim())
    .filter(Boolean);
  if (applicableProductIds.length > 0 && !intersects(productIds, applicableProductIds)) {
    return { ok: false, status: 400, message: 'Coupon is not applicable to selected products' };
  }

  const categoryLookups = await getCategoryLookups();
  const resolvedCategories = resolveApplicableCategories(
    coupon.applicable_categories,
    categoryLookups,
  );
  if (
    !resolvedCategories.appliesToAll &&
    !categoriesMatch(categoryNames, resolvedCategories.matchKeys)
  ) {
    const label = joinCategoryList(resolvedCategories.display);
    return {
      ok: false,
      status: 400,
      message: label
        ? `Coupon is only applicable on ${label}`
        : 'Coupon is not applicable to items in your cart',
    };
  }

  if (coupon.usage_limit_total != null) {
    const totalUsageRes = await query('SELECT COUNT(*)::int AS c FROM coupon_usages WHERE coupon_id = $1', [coupon.id]);
    const totalUsed = Number(totalUsageRes.rows?.[0]?.c || 0);
    if (totalUsed >= Number(coupon.usage_limit_total)) {
      return { ok: false, status: 400, message: 'Coupon usage limit reached' };
    }
  }

  if (userId && coupon.usage_limit_per_user != null) {
    const perUserRes = await query(
      'SELECT COUNT(*)::int AS c FROM coupon_usages WHERE coupon_id = $1 AND user_id = $2',
      [coupon.id, userId],
    );
    const usedByUser = Number(perUserRes.rows?.[0]?.c || 0);
    if (usedByUser >= Number(coupon.usage_limit_per_user)) {
      return { ok: false, status: 400, message: 'You have reached usage limit for this coupon' };
    }
  }

  const discountType = String(coupon.discount_type || '').toLowerCase();
  let discountAmount = 0;
  if (discountType === 'percentage') {
    discountAmount = (subtotal * toNumber(coupon.discount_value, 0)) / 100;
  } else {
    discountAmount = toNumber(coupon.discount_value, 0);
  }
  if (coupon.maximum_discount != null) {
    discountAmount = Math.min(discountAmount, toNumber(coupon.maximum_discount, discountAmount));
  }
  discountAmount = Math.min(discountAmount, subtotal);

  return {
    ok: true,
    coupon,
    subtotal,
    discount_amount: Number(discountAmount.toFixed(2)),
    final_subtotal: Number((subtotal - discountAmount).toFixed(2)),
  };
}

export const listPublicCoupons = async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, code, discount_type, discount_value, minimum_order_amount, start_date, expiry_date,
              source_type, source_name,
              CASE
                WHEN (start_date IS NULL OR start_date <= NOW())
                 AND (expiry_date IS NULL OR expiry_date >= NOW())
                THEN TRUE
                ELSE FALSE
              END AS is_currently_valid
       FROM coupons
       WHERE LOWER(COALESCE(status, '')) = 'active'
         AND LOWER(COALESCE(visibility, 'public')) = 'public'
       ORDER BY created_at DESC, id DESC`,
    );
    res.json({ success: true, data: result.rows || [] });
  } catch (_error) {
    res.status(500).json({ success: false, message: 'Failed to fetch coupons' });
  }
};

export const validateCoupon = async (req, res) => {
  try {
    const { code, items } = req.body || {};
    const userId = req.user?.id || null;
    const evaluation = await evaluateCouponForCart({ code, items, userId });
    if (!evaluation.ok) {
      return res.status(evaluation.status).json({
        success: false,
        message: evaluation.message,
      });
    }
    return res.json({
      success: true,
      data: {
        code: evaluation.coupon.code,
        discount_amount: evaluation.discount_amount,
        subtotal: evaluation.subtotal,
        final_subtotal: evaluation.final_subtotal,
      },
    });
  } catch (_error) {
    return res.status(500).json({ success: false, message: 'Failed to validate coupon' });
  }
};

