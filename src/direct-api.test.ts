import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAddToCartPayload,
  buildUpdateCartPayload,
  normalizeItemName,
  parseSearchRestaurantRow,
} from "./direct-api.js";

test("normalizeItemName trims and collapses whitespace", () => {
  assert.equal(normalizeItemName("  Sushi   premium "), "sushi premium");
});

test("parseSearchRestaurantRow extracts restaurant metadata from facet rows", () => {
  const row = parseSearchRestaurantRow({
    id: "row.store:24633898:0",
    text: {
      title: "Poke Bowl",
      description: "$$ • Hawaiian, Seafood Restaurant",
      custom: [
        { key: "delivery_fee_string", value: "$0 delivery fee over $7" },
        { key: "eta_display_string", value: "1.0 mi • 32 min" },
        { key: "is_retail", value: "false" },
      ],
    },
    images: {
      main: {
        uri: "https://img.cdn4dd.com/example.jpeg",
      },
    },
    events: {
      click: {
        name: "navigate",
        data: JSON.stringify({ domain: "https://www.doordash.com/", uri: "store/24633898/?pickup=false" }),
      },
    },
    component: {
      id: "row.store",
      category: "row",
    },
  });

  assert.deepEqual(row, {
    id: "24633898",
    name: "Poke Bowl",
    description: "$$ • Hawaiian, Seafood Restaurant",
    cuisines: ["Hawaiian, Seafood Restaurant"],
    isRetail: false,
    eta: "1.0 mi • 32 min",
    deliveryFee: "$0 delivery fee over $7",
    imageUrl: "https://img.cdn4dd.com/example.jpeg",
    url: "https://www.doordash.com/store/24633898/?pickup=false",
  });
});

test("buildAddToCartPayload blocks items with required option groups", () => {
  assert.throws(
    () =>
      buildAddToCartPayload({
        restaurantId: "1721744",
        cartId: "",
        quantity: 1,
        specialInstructions: null,
        item: {
          id: "546936015",
          name: "Two roll selection",
          description: "Spicy tuna, salmon avo",
          displayPrice: "$18.98",
          imageUrl: null,
          nextCursor: null,
          storeId: "1721744",
        },
        itemDetail: {
          success: true,
          restaurantId: "1721744",
          item: {
            id: "546936015",
            name: "Two roll selection",
            description: "Spicy tuna, salmon avo",
            displayPrice: "$18.98",
            unitAmount: 1898,
            currency: "USD",
            decimalPlaces: 2,
            menuId: "2181443",
            specialInstructionsMaxLength: 500,
            dietaryTags: [],
            reviewData: null,
            requiredOptionLists: [
              {
                id: "703393388",
                name: "1st Roll Choice",
                subtitle: "Select 1",
                minNumOptions: 1,
                maxNumOptions: 1,
                numFreeOptions: 0,
                isOptional: false,
                options: [],
              },
            ],
            optionLists: [],
            preferences: [],
          },
        },
      }),
    /quick-add items with no required option groups/,
  );
});

test("buildAddToCartPayload preserves the captured DoorDash request shape for quick-add items", () => {
  const payload = buildAddToCartPayload({
    restaurantId: "1721744",
    cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    quantity: 2,
    specialInstructions: "extra napkins",
    item: {
      id: "876658890",
      name: " Sushi premium",
      description: "10pc sushi & NegiToro roll.",
      displayPrice: "$49.00",
      imageUrl: null,
      nextCursor: null,
      storeId: "1721744",
    },
    itemDetail: {
      success: true,
      restaurantId: "1721744",
      item: {
        id: "876658890",
        name: " Sushi premium",
        description: "10pc sushi & NegiToro roll.",
        displayPrice: "+$49.00",
        unitAmount: 4900,
        currency: "USD",
        decimalPlaces: 2,
        menuId: "2181443",
        specialInstructionsMaxLength: 500,
        dietaryTags: [],
        reviewData: null,
        requiredOptionLists: [],
        optionLists: [],
        preferences: [],
      },
    },
  });

  assert.deepEqual(payload, {
    addCartItemInput: {
      storeId: "1721744",
      menuId: "2181443",
      itemId: "876658890",
      itemName: " Sushi premium",
      itemDescription: "10pc sushi & NegiToro roll.",
      currency: "USD",
      quantity: 2,
      nestedOptions: "[]",
      specialInstructions: "extra napkins",
      substitutionPreference: "substitute",
      isBundle: false,
      bundleType: "BUNDLE_TYPE_UNSPECIFIED",
      unitPrice: 4900,
      cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    },
    fulfillmentContext: {
      shouldUpdateFulfillment: false,
      fulfillmentType: "Delivery",
    },
    monitoringContext: {
      isGroup: false,
    },
    cartContext: {
      isBundle: false,
    },
    returnCartFromOrderService: false,
    shouldKeepOnlyOneActiveCart: false,
  });
});

test("buildUpdateCartPayload preserves the captured DoorDash request shape", () => {
  const payload = buildUpdateCartPayload({
    cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    cartItemId: "3b231d03-5a72-4636-8d12-c8769d706d45",
    itemId: "876658890",
    quantity: 1,
    storeId: "1721744",
  });

  assert.deepEqual(payload, {
    updateCartItemApiParams: {
      cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
      cartItemId: "3b231d03-5a72-4636-8d12-c8769d706d45",
      itemId: "876658890",
      quantity: 1,
      storeId: "1721744",
      purchaseTypeOptions: {
        purchaseType: "PURCHASE_TYPE_UNSPECIFIED",
        continuousQuantity: 0,
        unit: null,
      },
      cartFilter: null,
    },
    fulfillmentContext: {
      shouldUpdateFulfillment: false,
    },
    returnCartFromOrderService: false,
  });
});
