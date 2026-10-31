
const Category = require("../models/category");
const Product = require("../models/product");
const express = require('express')
const router = express.Router()

router.get("/",async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .select("name slug description imageUrl sortOrder")
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    return res.status(200).json({
      count: categories.length,
      categories,
    });
  } catch (error) {
    console.error("Get categories error:", error);
    return res.status(500).json({
      message: "Unable to fetch categories",
    });
  }
});

module.exports = router;