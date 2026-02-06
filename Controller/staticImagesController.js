import supabase from '../config/supabaseClient.js';

const BUCKET = 'GGIMG';
const BASE_PATH = 'StaticImg';

function buildPublicUrl(folder, file_name) {
    const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
    if (!base) return null;
    return `${base}/storage/v1/object/public/${BUCKET}/${BASE_PATH}/${encodeURIComponent(folder)}/${encodeURIComponent(file_name)}`;
}

/**
 * GET /api/static-images?folder=Zodiac
 * GET /api/static-images?folder=Rudrakshas
 * GET /api/static-images  (returns all folders, grouped)
 */
export const getStaticImages = async (req, res) => {
    try {
        const { folder } = req.query;

        let query = supabase
            .from('static_images')
            .select('id, folder, key, file_name, url, sort_order')
            .order('sort_order', { ascending: true })
            .order('key', { ascending: true });

        if (folder) {
            query = query.eq('folder', folder);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Supabase static_images error:', error);
            return res.status(500).json({ error: 'Failed to fetch static images' });
        }

        const items = (data || []).map((row) => ({
            id: row.id,
            folder: row.folder,
            key: row.key,
            file_name: row.file_name,
            sort_order: row.sort_order,
            url: row.url || buildPublicUrl(row.folder, row.file_name)
        }));

        if (folder) {
            return res.json(items);
        }

        const byFolder = items.reduce((acc, item) => {
            if (!acc[item.folder]) acc[item.folder] = [];
            acc[item.folder].push(item);
            return acc;
        }, {});

        res.json(byFolder);
    } catch (err) {
        console.error('getStaticImages error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
