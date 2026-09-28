/**
 * Sitemap paths for Phase 3 landing pages.
 * Kept inside the API image. The storefront Worker reads the same routes from
 * client/src/seo/landings.js — update both if a landing URL is added or removed.
 */
const MUKHI = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RASHI = [
  'aries',
  'taurus',
  'gemini',
  'cancer',
  'leo',
  'virgo',
  'libra',
  'scorpio',
  'sagittarius',
  'capricorn',
  'aquarius',
  'pisces',
];

const PURPOSES = ['protection', 'focus', 'wealth', 'health', 'peace'];

const GUIDES = [
  'how-to-identify-real-rudraksha',
  'which-rudraksha-should-i-wear',
  'how-to-wear-and-care-for-rudraksha',
];

export function landingSitemapPaths() {
  return [
    ...MUKHI.map((n) => `/mukhi/${n}-mukhi-rudraksha`),
    ...RASHI.map((slug) => `/rashi/${slug}`),
    ...PURPOSES.map((slug) => `/purpose/${slug}`),
    ...GUIDES.map((slug) => `/guides/${slug}`),
  ];
}
