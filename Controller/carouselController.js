import supabase from '../config/supabaseClient.js';

// Get all carousel images filtered by device type
export const getCarouselImages = async (req, res) => {
    try {
        const { device_type } = req.query;
        
        // Default to desktop if device_type is not provided
        const filterDeviceType = device_type || 'desktop';
        
        // Always filter by device_type - normalize to lowercase for case-insensitive matching
        const { data, error } = await supabase
            .from('website_carousel')
            .select('id, image_url, device_type, created_at')
            .eq('device_type', filterDeviceType.toLowerCase())
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: 'Failed to fetch carousel images' });
        }

        res.json(data || []);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

