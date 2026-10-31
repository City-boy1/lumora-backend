
const Product = require('../models/product');
const mongoose = require('mongoose');

const checkProductOwner = async (req, res, next) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                message: 'Invalid product ID'
            });
        }

        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                message: 'Product not found'
            });
        }

        if (!req.user?.id) {
            return res.status(401).json({
                message: 'Authentication required'
            });
        }

        if (req.user.role !== 'admin') {
            if (product.createdBy.toString() !== req.user.id.toString()) {
                return res.status(403).json({
                    message: 'Not your product'
                });
            }
        }

        req.product = product;
        return next();

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: 'Internal Server Error'
        });
    }
};

module.exports = checkProductOwner;