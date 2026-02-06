import express from 'express';
import { getStaticImages } from '../Controller/staticImagesController.js';

const router = express.Router();

router.get('/', getStaticImages);

export default router;
