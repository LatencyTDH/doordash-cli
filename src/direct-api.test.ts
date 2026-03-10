import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAddConsumerAddressPayload,
  buildAddToCartPayload,
  buildUpdateCartPayload,
  normalizeItemName,
  parseOptionSelectionsJson,
  parseSearchRestaurantRow,
  resolveAvailableAddressMatch,
  type ItemResult,
} from "./direct-api.js";

function configurableItemDetail(): ItemResult {
  return {
    success: true,
    restaurantId: "1721744",
    item: {
      id: "546936015",
      name: "Two roll selection",
      description: "Spicy tuna, salmon avo, eel cuc, yellowtail scallion, California Roll.",
      displayPrice: "+$18.98",
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
          options: [
            {
              id: "4716032529",
              name: "California Roll",
              displayPrice: "",
              unitAmount: 0,
              defaultQuantity: 0,
              nextCursor: null,
            },
          ],
        },
        {
          id: "703393389",
          name: "2nd Roll Choice",
          subtitle: "Select 1",
          minNumOptions: 1,
          maxNumOptions: 1,
          numFreeOptions: 0,
          isOptional: false,
          options: [
            {
              id: "4716042466",
              name: "California Roll",
              displayPrice: "",
              unitAmount: 0,
              defaultQuantity: 0,
              nextCursor: null,
            },
          ],
        },
      ],
      optionLists: [
        {
          id: "703393388",
          name: "1st Roll Choice",
          subtitle: "Select 1",
          minNumOptions: 1,
          maxNumOptions: 1,
          numFreeOptions: 0,
          isOptional: false,
          options: [
            {
              id: "4716032529",
              name: "California Roll",
              displayPrice: "",
              unitAmount: 0,
              defaultQuantity: 0,
              nextCursor: null,
            },
          ],
        },
        {
          id: "703393389",
          name: "2nd Roll Choice",
          subtitle: "Select 1",
          minNumOptions: 1,
          maxNumOptions: 1,
          numFreeOptions: 0,
          isOptional: false,
          options: [
            {
              id: "4716042466",
              name: "California Roll",
              displayPrice: "",
              unitAmount: 0,
              defaultQuantity: 0,
              nextCursor: null,
            },
          ],
        },
      ],
      preferences: [],
    },
  };
}

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

test("parseOptionSelectionsJson parses structured recursive option selections", () => {
  assert.deepEqual(
    parseOptionSelectionsJson(
      '[{"groupId":"703393388","optionId":"4716032529"},{"groupId":"recommended_option_546935995","optionId":"546936011","children":[{"groupId":"780057412","optionId":"4702669757","quantity":2}]}]',
    ),
    [
      { groupId: "703393388", optionId: "4716032529" },
      {
        groupId: "recommended_option_546935995",
        optionId: "546936011",
        children: [{ groupId: "780057412", optionId: "4702669757", quantity: 2 }],
      },
    ],
  );
});

test("parseOptionSelectionsJson rejects malformed payloads", () => {
  assert.throws(() => parseOptionSelectionsJson('{"groupId":"x"}'), /must be a JSON array/);
  assert.throws(() => parseOptionSelectionsJson('[{"groupId":"703393388"}]'), /must include string groupId and optionId/);
  assert.throws(
    () => parseOptionSelectionsJson('[{"groupId":"703393388","optionId":"4716032529","quantity":0}]'),
    /Invalid option quantity/,
  );
  assert.throws(
    () => parseOptionSelectionsJson('[{"groupId":"703393388","optionId":"4716032529","children":{}}]'),
    /children must be an array/,
  );
});

test("resolveAvailableAddressMatch prefers a saved address id from autocomplete/get-or-create", () => {
  const match = resolveAvailableAddressMatch({
    input: "350 5th Ave, New York, NY 10118",
    availableAddresses: [
      {
        id: "5266870966",
        addressId: "1387447699",
        printableAddress: "350 5th Ave, New York, NY 10118, USA",
        shortname: "350 5th Ave",
      },
    ],
    prediction: {
      geo_address_id: "1387447699",
      formatted_address: "350 5th Ave, New York, NY 10118, USA",
    },
    createdAddress: {
      id: "1387447699",
      formatted_address: "350 5th Ave, New York, NY 10118, USA",
    },
  });

  assert.deepEqual(match, {
    id: "5266870966",
    printableAddress: "350 5th Ave, New York, NY 10118, USA",
    source: "autocomplete-address-id",
  });
});

test("resolveAvailableAddressMatch falls back to printable/shortname text matching", () => {
  const match = resolveAvailableAddressMatch({
    input: "350 5th Ave, New York, NY 10118",
    availableAddresses: [
      {
        id: "5266870966",
        addressId: "1387447699",
        printableAddress: "350 5th Ave, New York, NY 10118, USA",
        shortname: "350 5th Ave",
      },
    ],
  });

  assert.deepEqual(match, {
    id: "5266870966",
    printableAddress: "350 5th Ave, New York, NY 10118, USA",
    source: "saved-address",
  });
});

test("buildAddConsumerAddressPayload maps autocomplete/get-or-create data into addConsumerAddressV2 variables", () => {
  const payload = buildAddConsumerAddressPayload({
    requestedAddress: "11 Wall St, New York, NY 10005",
    prediction: {
      source_place_id: "ChIJ8fw4t0hawokRk1YdVjndM9w",
      formatted_address: "11 Wall St, New York, NY 10005, USA",
      formatted_address_short: "11 Wall St",
      locality: "New York",
      administrative_area_level1: "NY",
      postal_code: "10005",
      lat: 40.707757,
      lng: -74.010045,
    },
    createdAddress: {
      id: "1386875882",
      formatted_address: "11 Wall St, New York, NY 10005, USA",
      formatted_address_short: "11 Wall St",
      locality: "New York",
      administrative_area_level1: "NY",
      postal_code: "10005",
      lat: 40.707757,
      lng: -74.010045,
    },
  });

  assert.deepEqual(payload, {
    lat: 40.707757,
    lng: -74.010045,
    city: "New York",
    state: "NY",
    zipCode: "10005",
    printableAddress: "11 Wall St, New York, NY 10005, USA",
    shortname: "11 Wall St",
    googlePlaceId: "ChIJ8fw4t0hawokRk1YdVjndM9w",
    subpremise: null,
    driverInstructions: null,
    dropoffOptionId: null,
    manualLat: null,
    manualLng: null,
    addressLinkType: "ADDRESS_LINK_TYPE_UNSPECIFIED",
    buildingName: null,
    entryCode: null,
    personalAddressLabel: null,
  });
});

test("buildAddToCartPayload blocks required-option items when no selections are provided", async () => {
  await assert.rejects(
    () =>
      buildAddToCartPayload({
        restaurantId: "1721744",
        cartId: "",
        quantity: 1,
        specialInstructions: null,
        optionSelections: [],
        item: {
          id: "546936015",
          name: "Two roll selection",
          description: "Spicy tuna, salmon avo",
          displayPrice: "$18.98",
          imageUrl: null,
          nextCursor: null,
          storeId: "1721744",
        },
        itemDetail: configurableItemDetail(),
      }),
    /required option groups/,
  );
});

test("buildAddToCartPayload preserves the captured DoorDash request shape for quick-add items", async () => {
  const payload = await buildAddToCartPayload({
    restaurantId: "1721744",
    cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    quantity: 2,
    specialInstructions: "extra napkins",
    optionSelections: [],
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
    lowPriorityBatchAddCartItemInput: [],
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

test("buildAddToCartPayload builds validated nestedOptions for configurable items", async () => {
  const payload = await buildAddToCartPayload({
    restaurantId: "1721744",
    cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    quantity: 1,
    specialInstructions: null,
    optionSelections: [
      { groupId: "703393388", optionId: "4716032529" },
      { groupId: "703393389", optionId: "4716042466" },
    ],
    item: {
      id: "546936015",
      name: "Two roll selection",
      description: "Spicy tuna, salmon avo, eel cuc, yellowtail scallion, California Roll.",
      displayPrice: "$18.98",
      imageUrl: null,
      nextCursor: null,
      storeId: "1721744",
    },
    itemDetail: configurableItemDetail(),
  });

  assert.deepEqual(JSON.parse(payload.addCartItemInput.nestedOptions), [
    {
      id: "4716032529",
      quantity: 1,
      options: [],
      itemExtraOption: {
        id: "4716032529",
        name: "California Roll",
        description: "California Roll",
        price: 0,
        itemExtraName: null,
        chargeAbove: 0,
        defaultQuantity: 0,
        itemExtraId: "703393388",
        itemExtraNumFreeOptions: 0,
        menuItemExtraOptionPrice: 0,
        menuItemExtraOptionBasePrice: null,
      },
    },
    {
      id: "4716042466",
      quantity: 1,
      options: [],
      itemExtraOption: {
        id: "4716042466",
        name: "California Roll",
        description: "California Roll",
        price: 0,
        itemExtraName: null,
        chargeAbove: 0,
        defaultQuantity: 0,
        itemExtraId: "703393389",
        itemExtraNumFreeOptions: 0,
        menuItemExtraOptionPrice: 0,
        menuItemExtraOptionBasePrice: null,
      },
    },
  ]);
});

test("buildAddToCartPayload routes standalone recommended next-cursor items into lowPriorityBatchAddCartItemInput", async () => {
  const detail = configurableItemDetail();
  detail.item.optionLists.push({
    id: "recommended_option_546935995",
    name: "Recommended Beverages",
    subtitle: null,
    minNumOptions: 0,
    maxNumOptions: 10,
    numFreeOptions: 0,
    isOptional: true,
    options: [
      {
        id: "546936011",
        name: "Sake (salmon)",
        displayPrice: "+$5.00",
        unitAmount: 500,
        defaultQuantity: 0,
        nextCursor: "opaque-next-cursor",
      },
    ],
  });

  const payload = await buildAddToCartPayload({
    restaurantId: "1721744",
    cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
    quantity: 1,
    specialInstructions: null,
    optionSelections: [
      { groupId: "703393388", optionId: "4716032529" },
      { groupId: "703393389", optionId: "4716042466" },
      {
        groupId: "recommended_option_546935995",
        optionId: "546936011",
        children: [{ groupId: "780057412", optionId: "4702669757" }],
      },
    ],
    item: {
      id: "546936015",
      name: "Two roll selection",
      description: "Spicy tuna, salmon avo, eel cuc, yellowtail scallion, California Roll.",
      displayPrice: "$18.98",
      imageUrl: null,
      nextCursor: null,
      storeId: "1721744",
    },
    itemDetail: detail,
    resolveNestedOptionLists: async () => [
      {
        id: "780057412",
        name: "Choice",
        subtitle: "Select 1",
        minNumOptions: 1,
        maxNumOptions: 1,
        numFreeOptions: 0,
        isOptional: false,
        options: [
          {
            id: "4702669757",
            name: "sashimi",
            displayPrice: "",
            unitAmount: 0,
            defaultQuantity: 0,
            nextCursor: null,
          },
        ],
      },
    ],
  });

  assert.deepEqual(payload.lowPriorityBatchAddCartItemInput, [
    {
      cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
      storeId: "1721744",
      menuId: "2181443",
      itemId: "546936011",
      itemName: "Sake (salmon)",
      currency: "USD",
      quantity: 1,
      unitPrice: 500,
      isBundle: false,
      bundleType: "BUNDLE_TYPE_UNSPECIFIED",
      nestedOptions: JSON.stringify([
        {
          id: "4702669757",
          quantity: 1,
          options: [],
          itemExtraOption: {
            id: "4702669757",
            name: "sashimi",
            description: "sashimi",
            price: 0,
            chargeAbove: 0,
            defaultQuantity: 0,
          },
        },
      ]),
    },
  ]);
});

test("buildAddToCartPayload still fails closed for non-recommended next-cursor groups", async () => {
  const detail = configurableItemDetail();
  const nestedOption = detail.item.optionLists[1]?.options[0];
  assert.ok(nestedOption);
  nestedOption.nextCursor = "opaque-next-cursor";

  await assert.rejects(
    () =>
      buildAddToCartPayload({
        restaurantId: "1721744",
        cartId: "90a554a1-cc69-462b-8860-911ddf2d7f88",
        quantity: 1,
        specialInstructions: null,
        optionSelections: [
          { groupId: "703393388", optionId: "4716032529" },
          { groupId: "703393389", optionId: "4716042466" },
        ],
        item: {
          id: "546936015",
          name: "Two roll selection",
          description: "Spicy tuna, salmon avo, eel cuc, yellowtail scallion, California Roll.",
          displayPrice: "$18.98",
          imageUrl: null,
          nextCursor: null,
          storeId: "1721744",
        },
        itemDetail: detail,
        resolveNestedOptionLists: async () => [],
      }),
    /safe direct cart shape is only confirmed for standalone recommended add-on groups/,
  );
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
