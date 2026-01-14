import express from 'express';
import {
    createOrder,
    getUserOrders,
    getOrderById,
    updateOrderStatus
} from '../Controller/orderController.js';

const router = express.Router();

// Create new order
router.post('/', createOrder);

// Get all orders for a user
router.get('/user/:userId', getUserOrders);

// Get single order by ID
router.get('/:id', getOrderById);

// Update order status
router.patch('/:id/status', updateOrderStatus);

export default router;

