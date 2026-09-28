import express from 'express';
import { getSitemapUrls, getSitemapXml } from '../Controller/seoController.js';

const router = express.Router();

router.get('/sitemap-urls', getSitemapUrls);
router.get('/sitemap.xml', getSitemapXml);

export default router;
