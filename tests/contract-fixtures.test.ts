import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAddConsumerAddressPayload,
  buildAddToCartPayload,
  buildAuthResult,
  buildUpdateCartPayload,
  extractExistingOrdersFromApolloCache,
  parseCartResponse,
  parseExistingOrdersResponse,
  parseMenuResponse,
  parseSearchRestaurants,
  parseItemResponse,
  resolveAvailableAddressMatch,
} from "../src/direct-api.js";

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as T;
}

describe("sanitized fixture contract suite", () => {
  it("normalizes a sanitized consumer fixture into the auth contract", () => {
    const fixture = loadJson<Record<string, unknown>>("./fixtures/auth-consumer.json");
    const expected = loadJson<Record<string, unknown>>("./contracts/auth-consumer.json");

    const actual = buildAuthResult(fixture as never);

    expect({
      ...actual,
      cookiesPath: "__SESSION_COOKIES_PATH__",
      storageStatePath: "__SESSION_STORAGE_STATE_PATH__",
    }).toEqual(expected);
  });

  it("keeps address matching and add-consumer payload shaping stable", () => {
    const fixture = loadJson<{
      input: string;
      availableAddresses: unknown[];
      prediction: Record<string, unknown>;
      createdAddress: Record<string, unknown>;
    }>("./fixtures/address-context.json");

    expect(
      resolveAvailableAddressMatch({
        input: fixture.input,
        availableAddresses: fixture.availableAddresses as never,
        prediction: fixture.prediction as never,
        createdAddress: fixture.createdAddress as never,
      }),
    ).toEqual(loadJson("./contracts/address-match.json"));

    expect(
      buildAddConsumerAddressPayload({
        requestedAddress: fixture.input,
        prediction: fixture.prediction as never,
        createdAddress: fixture.createdAddress as never,
      }),
    ).toEqual(loadJson("./contracts/add-consumer-address-payload.json"));
  });

  it("replays sanitized search rows through the restaurant parser", () => {
    const fixture = loadJson<unknown[]>("./fixtures/search-rows.json");
    expect(parseSearchRestaurants(fixture)).toEqual(loadJson("./contracts/search-restaurants.json"));
  });

  it("replays sanitized menu payloads through the menu parser", () => {
    const fixture = loadJson<Record<string, unknown>>("./fixtures/menu-response.json");
    expect(parseMenuResponse(fixture, "1721744")).toEqual(loadJson("./contracts/menu-result.json"));
  });

  it("replays sanitized item payloads through the item parser", () => {
    const fixture = loadJson<Record<string, unknown>>("./fixtures/item-response.json");
    expect(parseItemResponse(fixture, "1721744")).toEqual(loadJson("./contracts/item-result.json"));
  });

  it("replays sanitized cart payloads through the cart parser", () => {
    const fixture = loadJson<Record<string, unknown>>("./fixtures/cart-response.json");
    expect(parseCartResponse(fixture)).toEqual(loadJson("./contracts/cart-result.json"));
  });

  it("replays sanitized order history payloads through the order-history parser", () => {
    const fixture = loadJson<unknown[]>("./fixtures/orders-response.json");
    expect(parseExistingOrdersResponse(fixture)).toEqual(loadJson("./contracts/orders-result.json"));
  });

  it("replays sanitized Apollo cache payloads through the cache extractor", () => {
    const fixture = loadJson<Record<string, unknown>>("./fixtures/orders-apollo-cache.json");
    expect(extractExistingOrdersFromApolloCache(fixture)).toEqual(loadJson("./contracts/orders-apollo.json"));
  });

  it("keeps the quick-add cart mutation payload stable", async () => {
    const fixture = loadJson<Record<string, unknown>>("./fixtures/add-to-cart-quick.json");
    await expect(
      buildAddToCartPayload({
        restaurantId: fixture.restaurantId as string,
        cartId: fixture.cartId as string,
        quantity: fixture.quantity as number,
        specialInstructions: fixture.specialInstructions as string,
        optionSelections: fixture.optionSelections as never,
        item: fixture.item as never,
        itemDetail: fixture.itemDetail as never,
      }),
    ).resolves.toEqual(loadJson("./contracts/add-to-cart-quick.json"));
  });

  it("keeps configurable nested-options payloads and recommended add-on batching stable", async () => {
    const fixture = loadJson<Record<string, unknown>>("./fixtures/add-to-cart-configurable.json");
    const expected = loadJson<{
      nestedOptions: unknown[];
      lowPriorityBatchAddCartItemInput: Array<Record<string, unknown>>;
    }>("./contracts/add-to-cart-configurable.json");

    const actual = await buildAddToCartPayload({
      restaurantId: fixture.restaurantId as string,
      cartId: fixture.cartId as string,
      quantity: fixture.quantity as number,
      specialInstructions: fixture.specialInstructions as null,
      optionSelections: fixture.optionSelections as never,
      item: fixture.item as never,
      itemDetail: fixture.itemDetail as never,
      resolveNestedOptionLists: async () => fixture.recommendedNestedOptionLists as never,
    });

    expect(JSON.parse(actual.addCartItemInput.nestedOptions)).toEqual(expected.nestedOptions);
    expect(
      actual.lowPriorityBatchAddCartItemInput.map((entry) => ({
        ...entry,
        nestedOptions: JSON.parse(entry.nestedOptions),
      })),
    ).toEqual(expected.lowPriorityBatchAddCartItemInput);
  });

  it("fails closed when required configurable selections are omitted", async () => {
    const fixture = loadJson<Record<string, unknown>>("./fixtures/add-to-cart-configurable.json");

    await expect(
      buildAddToCartPayload({
        restaurantId: fixture.restaurantId as string,
        cartId: fixture.cartId as string,
        quantity: fixture.quantity as number,
        specialInstructions: fixture.specialInstructions as null,
        optionSelections: [],
        item: fixture.item as never,
        itemDetail: fixture.itemDetail as never,
      }),
    ).rejects.toThrow(/required option groups/);
  });

  it("keeps update-cart payload shaping stable", () => {
    const fixture = loadJson<Record<string, unknown>>("./fixtures/update-cart.json");
    expect(
      buildUpdateCartPayload({
        cartId: fixture.cartId as string,
        cartItemId: fixture.cartItemId as string,
        itemId: fixture.itemId as string,
        quantity: fixture.quantity as number,
        storeId: fixture.storeId as string,
      }),
    ).toEqual(loadJson("./contracts/update-cart.json"));
  });
});
