
const mongoose = require("mongoose");
const Category = require("./models/Category");
require("dotenv").config();

const categories = [
  {
    name: "Fashion",
    slug: "fashion",
    description: "Clothing, footwear and everyday style.",
    imageUrl: "https://images.unsplash.com/photo-1483985988355-763728e1935b",
    sortOrder: 1,
  },
  {
    name: "Electronics",
    slug: "electronics",
    description: "Phones, computers, gadgets and accessories.",
    imageUrl: "https://images.unsplash.com/photo-1498049794561-7780e7231661",
    sortOrder: 2,
  },
  {
    name: "Home & Living",
    slug: "home-living",
    description: "Furniture, decor and household essentials.",
    imageUrl: "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace",
    sortOrder: 3,
  },
  {
    name: "Beauty & Personal Care",
    slug: "beauty-personal-care",
    description: "Skincare, makeup and personal care products.",
    imageUrl: "https://images.unsplash.com/photo-1596462502278-27bfdc403348",
    sortOrder: 4,
  },
  {
    name: "Health & Wellness",
    slug: "health-wellness",
    description: "Everyday wellness and personal care essentials.",
    imageUrl: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b",
    sortOrder: 5,
  },
  {
    name: "Sports & Outdoors",
    slug: "sports-outdoors",
    description: "Sports equipment, fitness gear and outdoor essentials.",
    imageUrl: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48",
    sortOrder: 6,
  },
  {
    name: "Books & Stationery",
    slug: "books-stationery",
    description: "Books, notebooks, writing tools and learning materials.",
    imageUrl: "https://images.unsplash.com/photo-1507842217343-583bb7270b66",
    sortOrder: 7,
  },
  {
    name: "Toys & Games",
    slug: "toys-games",
    description: "Toys, board games and entertainment for all ages.",
    imageUrl: "https://images.unsplash.com/photo-1558877385-81a1e6e7e4d0",
    sortOrder: 8,
  },
  {
    name: "Baby & Kids",
    slug: "baby-kids",
    description: "Baby essentials, children's clothing and accessories.",
    imageUrl: "https://images.unsplash.com/photo-1519689680058-324335c77eba",
    sortOrder: 9,
  },
  {
    name: "Jewelry & Accessories",
    slug: "jewelry-accessories",
    description: "Jewelry, watches, bags and fashion accessories.",
    imageUrl: "https://images.unsplash.com/photo-1611652022419-a9419f74343d",
    sortOrder: 10,
  },
  {
    name: "Shoes",
    slug: "shoes",
    description: "Sneakers, formal shoes, sandals and boots.",
    imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
    sortOrder: 11,
  },
  {
    name: "Bags & Luggage",
    slug: "bags-luggage",
    description: "Handbags, backpacks, travel bags and luggage.",
    imageUrl: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62",
    sortOrder: 12,
  },
  {
    name: "Food & Groceries",
    slug: "food-groceries",
    description: "Packaged foods, pantry staples and grocery products.",
    imageUrl: "https://images.unsplash.com/photo-1542838132-92c53300491e",
    sortOrder: 13,
  },
  {
    name: "Automotive",
    slug: "automotive",
    description: "Car accessories, tools and vehicle essentials.",
    imageUrl: "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7",
    sortOrder: 14,
  },
  {
    name: "Pet Supplies",
    slug: "pet-supplies",
    description: "Pet food, toys, accessories and care products.",
    imageUrl: "https://images.unsplash.com/photo-1450778869180-41d0601e046e",
    sortOrder: 15,
  },
  {
    name: "Office & Business",
    slug: "office-business",
    description: "Office furniture, supplies and business essentials.",
    imageUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72",
    sortOrder: 16,
  },
  {
    name: "Garden & Outdoor Living",
    slug: "garden-outdoor-living",
    description: "Gardening tools, plants and outdoor accessories.",
    imageUrl: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b",
    sortOrder: 17,
  },
  {
    name: "Arts & Crafts",
    slug: "arts-crafts",
    description: "Art supplies, craft materials and creative tools.",
    imageUrl: "https://images.unsplash.com/photo-1513364776144-60967b0f800f",
    sortOrder: 18,
  },
  {
    name: "Musical Instruments",
    slug: "musical-instruments",
    description: "Instruments, audio accessories and music equipment.",
    imageUrl: "https://images.unsplash.com/photo-1511379938547-c1f69419868d",
    sortOrder: 19,
  },
  {
    name: "Travel & Experiences",
    slug: "travel-experiences",
    description: "Travel accessories, experiences and related products.",
    imageUrl: "https://images.unsplash.com/photo-1488646953014-85cb44e25828",
    sortOrder: 20,
  },
];

async function seedCategories() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("MONGO_URI is missing from your .env file");
    }

    await mongoose.connect(process.env.DATABASE_URL);
    console.log("Connected to MongoDB");

    for (const category of categories) {
      await Category.updateOne(
        { slug: category.slug },
        {
          $setOnInsert: {
            ...category,
            isActive: true,
          },
        },
        { upsert: true }
      );
    }

    console.log(`Category seeding complete: ${categories.length} starter categories processed.`);
  } catch (error) {
    console.error("Category seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedCategories();