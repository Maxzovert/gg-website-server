import express from 'express';
import {
    getUserAddresses,
    getAddressById,
    createAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress
} from '../Controller/addressController.js';

const router = express.Router();

// Get all addresses for a user (must come before /:id)
router.get('/user/:userId', getUserAddresses);
router.get('/:id', getAddressById);

// Create new address
router.post('/', createAddress);

// Update address
router.put('/:id', updateAddress);

// Delete address (soft delete)
router.delete('/:id', deleteAddress);

// Set default address
router.patch('/:id/default', setDefaultAddress);

export default router;

