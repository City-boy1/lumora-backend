const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    title: {
        type: String,
        required: true
    },

    message: {
        type: String,
        required: true
    },

    type: {
        type: String,
        enum: [
            "product_approved",
            "product_rejected",
            "new_order",
            "order_update",
            "product_review",
            "store_suspended",
            "store_reinstated",
            "general"
        ],
        default: "general"
    },

    // Where the frontend sends the user when they click it (e.g. "/dashboard/store").
    link: {
        type: String,
        default: ""
    },

    relatedProduct: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        default: null
    },

    relatedOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
        default: null
    },

    isRead: {
        type: Boolean,
        default: false
    }

}, { timestamps: true });

// Fast "my notifications, newest first" and unread counts.
notificationSchema.index({ recipient: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);