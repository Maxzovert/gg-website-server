import supabase from '../config/supabaseClient.js';

// Get all addresses for a user
export const getUserAddresses = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const { data, error } = await supabase
            .from('addresses')
            .select('*')
            .eq('user_id', userId)
            .eq('is_active', true)
            .order('is_default', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch addresses',
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            data: data || []
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Get single address by ID
export const getAddressById = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;

        if (!id || !userId) {
            return res.status(400).json({
                success: false,
                message: 'Address ID and User ID are required'
            });
        }

        const { data, error } = await supabase
            .from('addresses')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .eq('is_active', true)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    message: 'Address not found'
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch address',
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Create new address
export const createAddress = async (req, res) => {
    try {
        const {
            user_id,
            receiver_name,
            receiver_phone,
            address_line1,
            address_line2,
            city,
            state,
            postal_code,
            country,
            latitude,
            longitude,
            is_default
        } = req.body;

        // Validation
        if (!user_id || !receiver_name || !receiver_phone || !address_line1 || !city || !state || !postal_code) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: user_id, receiver_name, receiver_phone, address_line1, city, state, postal_code'
            });
        }

        const addressData = {
            user_id,
            receiver_name,
            receiver_phone,
            address_line1,
            address_line2: address_line2 || null,
            city,
            state,
            postal_code,
            country: country || 'India',
            latitude: latitude || null,
            longitude: longitude || null,
            is_default: is_default || false,
            is_active: true
        };

        // If this is set as default, unset other defaults
        if (is_default) {
            await supabase
                .from('addresses')
                .update({ is_default: false })
                .eq('user_id', user_id)
                .neq('is_default', false);
        }

        const { data, error } = await supabase
            .from('addresses')
            .insert([addressData])
            .select()
            .single();

        if (error) {
            let errorMessage = 'Failed to create address';
            if (error.code === 'PGRST116') {
                errorMessage = 'Address table not found. Please run the database schema.';
            } else if (error.code === '42501') {
                errorMessage = 'Permission denied. Check RLS policies or use service role key.';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            return res.status(500).json({
                success: false,
                message: errorMessage,
                error: error.message
            });
        }

        res.status(201).json({
            success: true,
            message: 'Address created successfully',
            data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Update address
export const updateAddress = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            user_id,
            receiver_name,
            receiver_phone,
            address_line1,
            address_line2,
            city,
            state,
            postal_code,
            country,
            latitude,
            longitude,
            is_default
        } = req.body;

        if (!id || !user_id) {
            return res.status(400).json({
                success: false,
                message: 'Address ID and User ID are required'
            });
        }

        const updateData = {};
        if (receiver_name) updateData.receiver_name = receiver_name;
        if (receiver_phone) updateData.receiver_phone = receiver_phone;
        if (address_line1) updateData.address_line1 = address_line1;
        if (address_line2 !== undefined) updateData.address_line2 = address_line2;
        if (city) updateData.city = city;
        if (state) updateData.state = state;
        if (postal_code) updateData.postal_code = postal_code;
        if (country) updateData.country = country;
        if (latitude !== undefined) updateData.latitude = latitude;
        if (longitude !== undefined) updateData.longitude = longitude;
        if (is_default !== undefined) updateData.is_default = is_default;

        // If setting as default, unset other defaults
        if (is_default === true) {
            await supabase
                .from('addresses')
                .update({ is_default: false })
                .eq('user_id', user_id)
                .neq('id', id);
        }

        const { data, error } = await supabase
            .from('addresses')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', user_id)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    message: 'Address not found'
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to update address',
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            message: 'Address updated successfully',
            data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Delete address (soft delete)
export const deleteAddress = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;

        if (!id || !userId) {
            return res.status(400).json({
                success: false,
                message: 'Address ID and User ID are required'
            });
        }

        const { data, error } = await supabase
            .from('addresses')
            .update({ is_active: false })
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    message: 'Address not found'
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to delete address',
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            message: 'Address deleted successfully',
            data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Set default address
export const setDefaultAddress = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!id || !userId) {
            return res.status(400).json({
                success: false,
                message: 'Address ID and User ID are required'
            });
        }

        // Unset all other defaults
        await supabase
            .from('addresses')
            .update({ is_default: false })
            .eq('user_id', userId);

        // Set this address as default
        const { data, error } = await supabase
            .from('addresses')
            .update({ is_default: true })
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    message: 'Address not found'
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to set default address',
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            message: 'Default address updated successfully',
            data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

