import supabase from '../config/supabaseClient.js';

// Create new order
export const createOrder = async (req, res) => {
    try {
        const {
            user_id,
            address_id,
            items,
            total_amount,
            discount_amount = 0,
            shipping_charges = 0,
            payment_method,
            notes
        } = req.body;

        // Validation
        if (!user_id || !address_id || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: user_id, address_id, items (array)'
            });
        }

        if (!payment_method) {
            return res.status(400).json({
                success: false,
                message: 'Payment method is required'
            });
        }

        // Calculate final amount
        const final_amount = (total_amount || 0) - (discount_amount || 0) + (shipping_charges || 0);

        // Generate order number: GG-YYYYMMDD-XXXXX
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const { count } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', new Date().toISOString().split('T')[0]);
        
        const orderNumber = `GG-${today}-${String((count || 0) + 1).padStart(5, '0')}`;

        // Create order
        const orderData = {
            user_id,
            order_number: orderNumber,
            address_id,
            total_amount: total_amount || 0,
            discount_amount: discount_amount || 0,
            shipping_charges: shipping_charges || 0,
            final_amount,
            payment_method,
            payment_status: 'pending',
            order_status: 'pending',
            notes: notes || null
        };

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert([orderData])
            .select()
            .single();

        if (orderError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to create order',
                error: orderError.message
            });
        }

        // Create order items
        const orderItems = items.map(item => ({
            order_id: order.id,
            product_id: item.product_id,
            product_name: item.product_name,
            product_price: item.product_price,
            quantity: item.quantity,
            subtotal: item.product_price * item.quantity
        }));

        const { data: createdItems, error: itemsError } = await supabase
            .from('order_items')
            .insert(orderItems)
            .select();

        if (itemsError) {
            // Rollback order creation
            await supabase
                .from('orders')
                .delete()
                .eq('id', order.id);

            return res.status(500).json({
                success: false,
                message: 'Failed to create order items',
                error: itemsError.message
            });
        }

        // Update product stock quantities (optional - can be handled separately)
        for (const item of items) {
            await supabase.rpc('decrement_stock', {
                product_id: item.product_id,
                quantity: item.quantity
            }).catch(() => {});
        }

        // Fetch complete order with address and items
        const { data: completeOrder } = await supabase
            .from('orders')
            .select(`
                *,
                addresses (*),
                order_items (*)
            `)
            .eq('id', order.id)
            .single();

        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            data: completeOrder || { ...order, order_items: createdItems }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Get user orders
export const getUserOrders = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const { data, error } = await supabase
            .from('orders')
            .select(`
                *,
                addresses (*),
                order_items (*)
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch orders',
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

// Get single order by ID
export const getOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;

        if (!id || !userId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID and User ID are required'
            });
        }

        const { data, error } = await supabase
            .from('orders')
            .select(`
                *,
                addresses (*),
                order_items (*)
            `)
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch order',
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

// Update order status
export const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, order_status, payment_status } = req.body;

        if (!id || !userId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID and User ID are required'
            });
        }

        const updateData = {};
        if (order_status) updateData.order_status = order_status;
        if (payment_status) updateData.payment_status = payment_status;

        const { data, error } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to update order',
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            message: 'Order updated successfully',
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

