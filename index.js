import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import carouselRoutes from './Routes/carouselRoutes.js';
import productRoutes from './Routes/productRoutes.js';
import addressRoutes from './Routes/addressRoutes.js';
import orderRoutes from './Routes/orderRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/carousel', carouselRoutes);
app.use('/api/products', productRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);

// Error handling for undefined API routes (must be last)
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success: false,
            message: 'API route not found',
            path: req.path
        });
    }
    next();
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});