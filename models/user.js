const mongoose = require("mongoose")

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        password: {
            type: String,
            required: true,
            select: false,
        },

        passwordChangedAt:        { type: Date },
        passwordResetHash:        { type: String, default: null, select: false },
        passwordResetExpires:     { type: Date,   default: null, select: false },
        passwordResetRequestedAt: { type: Date,   default: null, select: false },

        role: {
            type: String,
            enum: ['buyer', 'seller', 'admin'],
            default: 'buyer',
        },

        avatar: {
            type: String,
            default: ""
        },

        phone: {
            type: String,
            trim: true,
            default: ""
        },

        address: {
            addressLine: { type: String, default: "" },
            apartment: { type: String, default: "" },
            city: { type: String, default: "" },
            region: { type: String, default: "" },
        },

        deliveryInstructions: {
            type: String,
            trim: true,
            maxLength: 300,
            default: ""
        },

        bio: {
            type: String,
            default: "",
            maxLength: 500,
        },

        sellerSince: { type: Date },
        sellerTermsAcceptedAt: { type: Date },

        refreshTokenHash: {
            type: String,
            default: null,
            select: false
        },
        refreshTokenPrevHash: { type: String, default: null, select: false },
        refreshTokenPrevUntil: { type: Date, default: null, select: false },
        deletedAt: { type: Date },
    }, {
        timestamps: true
    }
)

module.exports = mongoose.model("User", userSchema)