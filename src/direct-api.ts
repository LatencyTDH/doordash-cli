import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type Browser, type BrowserContext, type Cookie, type Page } from "playwright";
import { getCookiesPath } from "@striderlabs/mcp-doordash/dist/auth.js";

const BASE_URL = "https://www.doordash.com";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const GRAPHQL_HEADERS = {
  accept: "*/*",
  "content-type": "application/json",
  "x-channel-id": "marketplace",
  "x-experience-id": "doordash",
  "apollographql-client-name": "@doordash/app-consumer-production-ssr-client",
  "apollographql-client-version": "3.0",
} as const;

const CONSUMER_QUERY = `query consumer {
  consumer {
    id
    userId
    firstName
    lastName
    email
    isGuest
    marketId
    defaultAddress {
      printableAddress
      zipCode
      submarketId
    }
  }
}`;

const SEARCH_QUERY = `query searchWithFilterFacetFeed(
  $query: String!
  $cursor: String
  $filterQuery: String
  $isDebug: Boolean
  $fromFilterChange: Boolean
  $serializedBundleGlobalSearchContext: String
  $address: String
  $searchType: String
) {
  searchWithFilterFacetFeed(
    query: $query
    cursor: $cursor
    filterQuery: $filterQuery
    isDebug: $isDebug
    fromFilterChange: $fromFilterChange
    serializedBundleGlobalSearchContext: $serializedBundleGlobalSearchContext
    address: $address
    searchType: $searchType
  ) {
    body {
      id
      header {
        id
        name
        text {
          title
          subtitle
          description
          accessory
          custom {
            key
            value
          }
        }
      }
      body {
        id
        name
        text {
          title
          subtitle
          description
          accessory
          custom {
            key
            value
          }
        }
        images {
          main {
            uri
          }
        }
        events {
          click {
            name
            data
          }
        }
        childrenMap {
          id
          name
          text {
            title
            subtitle
            description
            accessory
            custom {
              key
              value
            }
          }
          images {
            main {
              uri
            }
          }
          events {
            click {
              name
              data
            }
          }
          component {
            id
            category
          }
        }
        component {
          id
          category
        }
      }
    }
  }
}`;

const STOREPAGE_QUERY = `query storepageFeed(
  $storeId: ID!
  $menuId: ID
  $isMerchantPreview: Boolean
  $fulfillmentType: FulfillmentType
  $cursor: String
  $menuSurfaceArea: MenuSurfaceArea
  $scheduledTime: String
  $scheduledMinTimeUtc: String
  $scheduledMaxTimeUtc: String
  $entryPoint: StoreEntryPoint
  $DMGroups: [DMGroup]
) {
  storepageFeed(
    storeId: $storeId
    menuId: $menuId
    isMerchantPreview: $isMerchantPreview
    fulfillmentType: $fulfillmentType
    cursor: $cursor
    menuSurfaceArea: $menuSurfaceArea
    scheduledTime: $scheduledTime
    scheduledMinTimeUtc: $scheduledMinTimeUtc
    scheduledMaxTimeUtc: $scheduledMaxTimeUtc
    entryPoint: $entryPoint
    DMGroups: $DMGroups
  ) {
    storeHeader {
      id
      name
      description
      business {
        id
        name
      }
      address {
        displayAddress
      }
      ratings {
        averageRating
        numRatingsDisplayString
      }
      coverImgUrl
    }
    menuBook {
      id
      name
      menuCategories {
        id
        name
        numItems
        next {
          anchor
          cursor
        }
      }
    }
    itemLists {
      id
      name
      description
      items {
        id
        name
        description
        displayPrice
        imageUrl
        nextCursor
        storeId
      }
      itemCategoryTabs {
        id
        name
        items {
          id
          name
          displayPrice
          nextCursor
          storeId
        }
      }
    }
  }
}`;

const ITEM_QUERY = `query itemPage(
  $storeId: ID!
  $itemId: ID!
  $consumerId: ID
  $isMerchantPreview: Boolean
  $isNested: Boolean!
  $fulfillmentType: FulfillmentType
  $cursorContext: ItemPageCursorContextInput
  $scheduledMinTimeUtc: String
  $scheduledMaxTimeUtc: String
) {
  itemPage(
    storeId: $storeId
    itemId: $itemId
    consumerId: $consumerId
    isMerchantPreview: $isMerchantPreview
    fulfillmentType: $fulfillmentType
    cursorContext: $cursorContext
    scheduledMinTimeUtc: $scheduledMinTimeUtc
    scheduledMaxTimeUtc: $scheduledMaxTimeUtc
  ) {
    itemHeader @skip(if: $isNested) {
      id
      name
      description
      displayString
      unitAmount
      currency
      decimalPlaces
      menuId
      specialInstructionsMaxLength
      dietaryTagsList {
        type
        abbreviatedTagDisplayString
        fullTagDisplayString
      }
      reviewData {
        ratingDisplayString
        reviewCount
        itemReviewRankingCount
      }
    }
    optionLists {
      id
      name
      subtitle
      minNumOptions
      maxNumOptions
      numFreeOptions
      isOptional
      options {
        id
        name
        displayString
        unitAmount
        defaultQuantity
        nextCursor
      }
    }
    itemPreferences {
      id
      title
      specialInstructions {
        title
        characterMaxLength
        isEnabled
        placeholderText
      }
      substitutionPreferences {
        title
        substitutionPreferencesList {
          id
          displayString
          isDefault
          value
        }
      }
    }
  }
}`;

const CURRENT_CART_QUERY = `query consumerOrderCart {
  consumerOrderCart {
    id
    subtotal
    total
    currencyCode
    restaurant {
      id
      name
      slug
      business {
        id
        name
      }
    }
    menu {
      id
      name
    }
    orders {
      id
      orderItems {
        id
        quantity
        specialInstructions
        priceDisplayString
        singlePrice
        priceOfTotalQuantity
        cartItemStatusType
        item {
          id
          name
          storeId
        }
        options {
          id
          name
          quantity
        }
      }
    }
  }
}`;

const ADD_TO_CART_MUTATION = `mutation addCartItem(
  $addCartItemInput: AddCartItemInput!
  $fulfillmentContext: FulfillmentContextInput!
  $cartContext: CartContextInput
  $returnCartFromOrderService: Boolean
  $monitoringContext: MonitoringContextInput
  $lowPriorityBatchAddCartItemInput: [AddCartItemInput!]
  $shouldKeepOnlyOneActiveCart: Boolean
  $selectedDeliveryOption: SelectedDeliveryOptionInput
) {
  addCartItemV2(
    addCartItemInput: $addCartItemInput
    fulfillmentContext: $fulfillmentContext
    cartContext: $cartContext
    returnCartFromOrderService: $returnCartFromOrderService
    monitoringContext: $monitoringContext
    lowPriorityBatchAddCartItemInput: $lowPriorityBatchAddCartItemInput
    shouldKeepOnlyOneActiveCart: $shouldKeepOnlyOneActiveCart
    selectedDeliveryOption: $selectedDeliveryOption
  ) {
    id
    subtotal
    total
    currencyCode
    restaurant {
      id
      name
      slug
      business {
        id
        name
      }
    }
    menu {
      id
      name
    }
    orders {
      id
      orderItems {
        id
        quantity
        specialInstructions
        priceDisplayString
        singlePrice
        priceOfTotalQuantity
        item {
          id
          name
          storeId
        }
        options {
          id
          name
          quantity
        }
      }
    }
  }
}`;

const UPDATE_CART_MUTATION = `mutation updateCartItem(
  $updateCartItemApiParams: UpdateCartItemInput!
  $fulfillmentContext: FulfillmentContextInput!
  $returnCartFromOrderService: Boolean
  $shouldKeepOnlyOneActiveCart: Boolean
  $cartContextFilter: CartContextV2
) {
  updateCartItemV2(
    updateCartItemInput: $updateCartItemApiParams
    fulfillmentContext: $fulfillmentContext
    returnCartFromOrderService: $returnCartFromOrderService
    shouldKeepOnlyOneActiveCart: $shouldKeepOnlyOneActiveCart
    cartContextFilter: $cartContextFilter
  ) {
    id
    subtotal
    total
    currencyCode
    restaurant {
      id
      name
      slug
      business {
        id
        name
      }
    }
    menu {
      id
      name
    }
    orders {
      id
      orderItems {
        id
        quantity
        specialInstructions
        priceDisplayString
        singlePrice
        priceOfTotalQuantity
        item {
          id
          name
          storeId
        }
        options {
          id
          name
          quantity
        }
      }
    }
  }
}`;

export type AuthResult = {
  success: true;
  isLoggedIn: boolean;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  consumerId: string | null;
  marketId: string | null;
  defaultAddress: {
    printableAddress: string | null;
    zipCode: string | null;
    submarketId: string | null;
  } | null;
  cookiesPath: string;
  storageStatePath: string;
};

export type AuthBootstrapResult = AuthResult & {
  message: string;
};

export type SearchRestaurantResult = {
  id: string;
  name: string;
  description: string | null;
  cuisines: string[];
  isRetail: boolean;
  eta: string | null;
  deliveryFee: string | null;
  imageUrl: string | null;
  url: string | null;
};

export type SearchResult = {
  success: true;
  query: string;
  cuisineFilter: string | null;
  count: number;
  restaurants: SearchRestaurantResult[];
};

export type MenuItemSummary = {
  id: string;
  name: string;
  description: string | null;
  displayPrice: string | null;
  imageUrl: string | null;
  nextCursor: string | null;
  storeId: string | null;
};

export type MenuCategoryResult = {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  items: MenuItemSummary[];
};

export type MenuResult = {
  success: true;
  restaurant: {
    id: string;
    name: string | null;
    description: string | null;
    businessName: string | null;
    displayAddress: string | null;
    averageRating: number | null;
    numRatingsDisplayString: string | null;
    coverImgUrl: string | null;
  };
  menu: {
    id: string | null;
    name: string | null;
  };
  categoryCount: number;
  itemCount: number;
  categories: MenuCategoryResult[];
};

export type ItemOptionResult = {
  id: string;
  name: string;
  displayPrice: string | null;
  unitAmount: number | null;
  defaultQuantity: number | null;
  nextCursor: string | null;
};

export type ItemOptionListResult = {
  id: string;
  name: string;
  subtitle: string | null;
  minNumOptions: number;
  maxNumOptions: number;
  numFreeOptions: number;
  isOptional: boolean;
  options: ItemOptionResult[];
};

export type ItemResult = {
  success: true;
  restaurantId: string;
  item: {
    id: string | null;
    name: string | null;
    description: string | null;
    displayPrice: string | null;
    unitAmount: number | null;
    currency: string | null;
    decimalPlaces: number | null;
    menuId: string | null;
    specialInstructionsMaxLength: number | null;
    dietaryTags: Array<{ type: string | null; abbreviatedTagDisplayString: string | null; fullTagDisplayString: string | null }>;
    reviewData: {
      ratingDisplayString: string | null;
      reviewCount: string | null;
      itemReviewRankingCount: number | null;
    } | null;
    requiredOptionLists: ItemOptionListResult[];
    optionLists: ItemOptionListResult[];
    preferences: unknown[];
  };
};

export type CartItemResult = {
  cartItemId: string;
  itemId: string | null;
  name: string | null;
  quantity: number;
  specialInstructions: string | null;
  priceDisplayString: string | null;
  singlePrice: number | null;
  totalPrice: number | null;
  status: string | null;
  options: Array<{ id: string; name: string | null; quantity: number | null }>;
};

export type CartResult = {
  success: true;
  cartId: string | null;
  subtotal: number | null;
  total: number | null;
  currencyCode: string | null;
  restaurant: {
    id: string | null;
    name: string | null;
    slug: string | null;
    businessName: string | null;
  } | null;
  menu: {
    id: string | null;
    name: string | null;
  } | null;
  itemCount: number;
  items: CartItemResult[];
};

export type AddToCartResult = CartResult & {
  sourceItem: {
    id: string;
    name: string;
    menuId: string | null;
  };
};

export type UpdateCartResult = CartResult & {
  updatedCartItemId: string;
};

export type AddToCartPayload = {
  addCartItemInput: {
    storeId: string;
    menuId: string;
    itemId: string;
    itemName: string;
    itemDescription: string | null;
    currency: string;
    quantity: number;
    nestedOptions: string;
    specialInstructions: string | null;
    substitutionPreference: string;
    isBundle: boolean;
    bundleType: string;
    unitPrice: number;
    cartId: string;
  };
  fulfillmentContext: {
    shouldUpdateFulfillment: boolean;
    fulfillmentType: string;
  };
  monitoringContext: {
    isGroup: boolean;
  };
  cartContext: {
    isBundle: boolean;
  };
  returnCartFromOrderService: boolean;
  shouldKeepOnlyOneActiveCart: boolean;
};

export type UpdateCartPayload = {
  updateCartItemApiParams: {
    cartId: string;
    cartItemId: string;
    itemId: string;
    quantity: number;
    storeId: string;
    purchaseTypeOptions: {
      purchaseType: string;
      continuousQuantity: number;
      unit: string | null;
    };
    cartFilter: null;
  };
  fulfillmentContext: {
    shouldUpdateFulfillment: boolean;
  };
  returnCartFromOrderService: boolean;
};

type ConsumerGraph = {
  id?: string | null;
  userId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  isGuest?: boolean | null;
  marketId?: string | null;
  defaultAddress?: {
    printableAddress?: string | null;
    zipCode?: string | null;
    submarketId?: string | null;
  } | null;
};

type GraphQlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type DirectBrowserOptions = {
  headed?: boolean;
  persistState?: boolean;
};

class DoorDashDirectSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async init(options: DirectBrowserOptions = {}): Promise<Page> {
    if (this.page) {
      return this.page;
    }

    const storageStatePath = getStorageStatePath();
    this.browser = await chromium.launch({
      headless: options.headed ? false : true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"],
    });

    this.context = await this.browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      locale: "en-US",
      viewport: { width: 1280, height: 900 },
      ...(await hasStorageState()) ? { storageState: storageStatePath } : {},
    });

    if (!(await hasStorageState())) {
      const cookies = await readStoredCookies();
      if (cookies.length > 0) {
        await this.context.addCookies(cookies);
      }
    }

    this.page = await this.context.newPage();
    await this.page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await this.page.waitForTimeout(1_500);
    return this.page;
  }

  async graphql<T>(operationName: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const page = await this.init();
    const url = `${BASE_URL}/graphql/${operationName}?operation=${operationName}`;
    const raw = await page.evaluate(
      async ({ targetUrl, body, headers }) => {
        const response = await fetch(targetUrl, {
          method: "POST",
          headers,
          body,
        });

        return {
          status: response.status,
          text: await response.text(),
        };
      },
      {
        targetUrl: url,
        body: JSON.stringify({ operationName, variables, query }),
        headers: GRAPHQL_HEADERS,
      },
    );

    return parseGraphQlResponse<T>(operationName, raw.status, raw.text);
  }

  async saveState(): Promise<void> {
    if (!this.context) {
      return;
    }

    const storageStatePath = getStorageStatePath();
    await ensureConfigDir();
    await this.context.storageState({ path: storageStatePath });

    const cookies = await this.context.cookies();
    await writeFile(getCookiesPath(), JSON.stringify(cookies, null, 2));
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => {});
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}

const session = new DoorDashDirectSession();

export async function checkAuthDirect(): Promise<AuthResult> {
  const data = await session.graphql<{ consumer: ConsumerGraph | null }>("consumer", CONSUMER_QUERY, {});
  const consumer = data.consumer ?? null;

  return {
    success: true,
    isLoggedIn: Boolean(consumer && consumer.isGuest === false),
    email: consumer?.email ?? null,
    firstName: consumer?.firstName ?? null,
    lastName: consumer?.lastName ?? null,
    consumerId: consumer?.id ?? null,
    marketId: consumer?.marketId ?? null,
    defaultAddress: consumer?.defaultAddress
      ? {
          printableAddress: consumer.defaultAddress.printableAddress ?? null,
          zipCode: consumer.defaultAddress.zipCode ?? null,
          submarketId: consumer.defaultAddress.submarketId ?? null,
        }
      : null,
    cookiesPath: getCookiesPath(),
    storageStatePath: getStorageStatePath(),
  };
}

export async function bootstrapAuthSession(): Promise<AuthBootstrapResult> {
  const page = await session.init({ headed: true });
  console.error("A Chromium window is open for DoorDash session bootstrap.");
  console.error("1) Sign in if needed.");
  console.error("2) Confirm your delivery address if needed.");
  console.error("3) Return here and press Enter to save the session for direct API use.");

  await page.goto(`${BASE_URL}/home`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});

  const rl = createInterface({ input, output });
  try {
    await rl.question("");
  } finally {
    rl.close();
  }

  await session.saveState();
  const auth = await checkAuthDirect();
  return {
    ...auth,
    message: auth.isLoggedIn
      ? "DoorDash session saved for direct API use."
      : "DoorDash session state saved, but the consumer still appears to be logged out or guest-only.",
  };
}

export async function clearStoredSession(): Promise<{ success: true; message: string; cookiesPath: string; storageStatePath: string }> {
  await session.close();
  await rm(getCookiesPath(), { force: true }).catch(() => {});
  await rm(getStorageStatePath(), { force: true }).catch(() => {});
  return {
    success: true,
    message: "DoorDash cookies and stored browser session state cleared.",
    cookiesPath: getCookiesPath(),
    storageStatePath: getStorageStatePath(),
  };
}

export async function searchRestaurantsDirect(query: string, cuisine?: string): Promise<SearchResult> {
  const data = await session.graphql<{ searchWithFilterFacetFeed?: { body?: Array<{ body?: unknown[] }> } }>(
    "searchWithFilterFacetFeed",
    SEARCH_QUERY,
    {
      query,
      cursor: "",
      filterQuery: "",
      isDebug: false,
      searchType: "",
    },
  );

  const rows = parseSearchRestaurants(data.searchWithFilterFacetFeed?.body ?? []);
  const cuisineFilter = cuisine?.trim() ? cuisine.trim() : null;
  const restaurants = cuisineFilter
    ? rows.filter((row) => row.description?.toLowerCase().includes(cuisineFilter.toLowerCase()))
    : rows;

  return {
    success: true,
    query,
    cuisineFilter,
    count: restaurants.length,
    restaurants,
  };
}

export async function getMenuDirect(restaurantId: string): Promise<MenuResult> {
  const data = await session.graphql<{ storepageFeed?: unknown }>("storepageFeed", STOREPAGE_QUERY, {
    storeId: restaurantId,
    menuId: null,
    isMerchantPreview: false,
    fulfillmentType: "Delivery",
    cursor: null,
    scheduledTime: null,
    entryPoint: "External",
  });

  return parseMenuResponse(data.storepageFeed, restaurantId);
}

export async function getItemDirect(restaurantId: string, itemId: string): Promise<ItemResult> {
  const auth = await checkAuthDirect();
  const data = await session.graphql<{ itemPage?: unknown }>("itemPage", ITEM_QUERY, {
    storeId: restaurantId,
    itemId,
    consumerId: auth.consumerId,
    isMerchantPreview: false,
    isNested: false,
    fulfillmentType: "Delivery",
    cursorContext: null,
  });

  return parseItemResponse(data.itemPage, restaurantId);
}

export async function getCartDirect(): Promise<CartResult> {
  const data = await session.graphql<{ consumerOrderCart?: unknown | null }>("consumerOrderCart", CURRENT_CART_QUERY, {});
  return parseCartResponse(data.consumerOrderCart ?? null);
}

export async function addToCartDirect(params: {
  restaurantId: string;
  itemName?: string;
  itemId?: string;
  quantity: number;
  specialInstructions?: string;
}): Promise<AddToCartResult> {
  const { item, itemDetail } = await resolveMenuItem(params.restaurantId, params.itemId, params.itemName);
  const currentCart = await getCartDirect();
  const auth = await checkAuthDirect();

  const payload = buildAddToCartPayload({
    restaurantId: params.restaurantId,
    cartId: currentCart.cartId ?? "",
    quantity: params.quantity,
    specialInstructions: params.specialInstructions ?? null,
    item,
    itemDetail,
  });

  const data = await session.graphql<{ addCartItemV2?: unknown }>("addCartItem", ADD_TO_CART_MUTATION, payload);
  const cart = parseCartResponse(data.addCartItemV2 ?? null);

  await session.saveState();

  return {
    ...cart,
    sourceItem: {
      id: item.id,
      name: item.name,
      menuId: itemDetail.item.menuId,
    },
  };
}

export async function updateCartDirect(params: {
  cartItemId: string;
  quantity: number;
}): Promise<UpdateCartResult> {
  const currentCart = await getCartDirect();
  if (!currentCart.cartId || !currentCart.restaurant?.id) {
    throw new Error("No active cart found to update.");
  }

  const cartItem = currentCart.items.find((item) => item.cartItemId === params.cartItemId);
  if (!cartItem?.itemId) {
    throw new Error(`Could not find cart item ${params.cartItemId} in the active cart.`);
  }

  const payload = buildUpdateCartPayload({
    cartId: currentCart.cartId,
    cartItemId: cartItem.cartItemId,
    itemId: cartItem.itemId,
    quantity: params.quantity,
    storeId: currentCart.restaurant.id,
  });

  const data = await session.graphql<{ updateCartItemV2?: unknown }>("updateCartItem", UPDATE_CART_MUTATION, payload);
  const cart = parseCartResponse(data.updateCartItemV2 ?? null);

  await session.saveState();

  return {
    ...cart,
    updatedCartItemId: params.cartItemId,
  };
}

export async function cleanupDirect(): Promise<void> {
  await session.close();
}

export function normalizeItemName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildAddToCartPayload(input: {
  restaurantId: string;
  cartId: string;
  quantity: number;
  specialInstructions: string | null;
  item: MenuItemSummary;
  itemDetail: ItemResult;
}): AddToCartPayload {
  const header = input.itemDetail.item;
  if (!header.id || !header.name || !header.menuId || header.unitAmount == null || !header.currency) {
    throw new Error("DoorDash item details were incomplete; cannot build a cart mutation safely.");
  }

  if (input.itemDetail.item.requiredOptionLists.length > 0) {
    const labels = input.itemDetail.item.requiredOptionLists.map((group) => `${group.name} (${group.minNumOptions}-${group.maxNumOptions})`);
    throw new Error(
      `Direct add-to-cart currently supports only quick-add items with no required option groups. Required groups: ${labels.join(", ")}`,
    );
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error(`Invalid quantity: ${input.quantity}`);
  }

  return {
    addCartItemInput: {
      storeId: input.restaurantId,
      menuId: header.menuId,
      itemId: header.id,
      itemName: header.name,
      itemDescription: header.description,
      currency: header.currency,
      quantity: input.quantity,
      nestedOptions: "[]",
      specialInstructions: input.specialInstructions,
      substitutionPreference: "substitute",
      isBundle: false,
      bundleType: "BUNDLE_TYPE_UNSPECIFIED",
      unitPrice: header.unitAmount,
      cartId: input.cartId,
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
  };
}

export function buildUpdateCartPayload(input: {
  cartId: string;
  cartItemId: string;
  itemId: string;
  quantity: number;
  storeId: string;
}): UpdateCartPayload {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new Error(`Invalid quantity: ${input.quantity}`);
  }

  return {
    updateCartItemApiParams: {
      cartId: input.cartId,
      cartItemId: input.cartItemId,
      itemId: input.itemId,
      quantity: input.quantity,
      storeId: input.storeId,
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
  };
}

export function parseSearchRestaurants(body: unknown[]): SearchRestaurantResult[] {
  const results: SearchRestaurantResult[] = [];

  for (const section of body) {
    const entries = asObject(section).body;
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      const parsed = parseSearchRestaurantRow(entry);
      if (parsed) {
        results.push(parsed);
      }
    }
  }

  return dedupeBy(results, (row) => row.id);
}

export function parseSearchRestaurantRow(entry: unknown): SearchRestaurantResult | null {
  const object = asObject(entry);
  const componentId = asObject(object.component).id;
  if (componentId !== "row.store") {
    return null;
  }

  const title = asObject(object.text).title;
  if (typeof title !== "string" || title.trim().length === 0) {
    return null;
  }

  const customPairs = Array.isArray(asObject(object.text).custom) ? asObject(object.text).custom : [];
  const custom = new Map<string, string>();
  for (const pair of customPairs) {
    const pairObject = asObject(pair);
    if (typeof pairObject.key === "string" && typeof pairObject.value === "string") {
      custom.set(pairObject.key, pairObject.value);
    }
  }

  const clickData = safeJsonParse<{ uri?: string }>(asObject(asObject(object.events).click).data);
  const url = clickData?.uri ? `${BASE_URL}/${clickData.uri.replace(/^\//, "")}` : null;
  const id = extractStoreId(url) ?? extractIdFromFacetId(typeof object.id === "string" ? object.id : "") ?? title.trim();
  const description = typeof asObject(object.text).description === "string" ? asObject(object.text).description : null;

  return {
    id,
    name: title.trim(),
    description,
    cuisines: parseCuisineDescription(description),
    isRetail: custom.get("is_retail") === "true",
    eta: custom.get("eta_display_string") ?? custom.get("cc_eta_string") ?? null,
    deliveryFee: custom.get("delivery_fee_string") ?? custom.get("modality_display_string") ?? null,
    imageUrl: asObject(asObject(object.images).main).uri ?? null,
    url,
  };
}

function parseMenuResponse(storepageFeed: unknown, requestedRestaurantId: string): MenuResult {
  const root = asObject(storepageFeed);
  const storeHeader = asObject(root.storeHeader);
  const menuBook = asObject(root.menuBook);
  const itemLists = Array.isArray(root.itemLists) ? root.itemLists : [];

  const categories = itemLists.map((list) => {
    const object = asObject(list);
    const items = Array.isArray(object.items) ? object.items : [];

    return {
      id: typeof object.id === "string" ? object.id : "",
      name: typeof object.name === "string" ? object.name : "",
      description: typeof object.description === "string" ? object.description : null,
      itemCount: items.length,
      items: items.map(parseMenuItem).filter((item): item is MenuItemSummary => item !== null),
    } satisfies MenuCategoryResult;
  });

  return {
    success: true,
    restaurant: {
      id: typeof storeHeader.id === "string" ? storeHeader.id : requestedRestaurantId,
      name: typeof storeHeader.name === "string" ? storeHeader.name : null,
      description: typeof storeHeader.description === "string" ? storeHeader.description : null,
      businessName: asObject(storeHeader.business).name ?? null,
      displayAddress: asObject(storeHeader.address).displayAddress ?? null,
      averageRating:
        typeof asObject(storeHeader.ratings).averageRating === "number"
          ? asObject(storeHeader.ratings).averageRating
          : null,
      numRatingsDisplayString: asObject(storeHeader.ratings).numRatingsDisplayString ?? null,
      coverImgUrl: typeof storeHeader.coverImgUrl === "string" ? storeHeader.coverImgUrl : null,
    },
    menu: {
      id: typeof menuBook.id === "string" ? menuBook.id : null,
      name: typeof menuBook.name === "string" ? menuBook.name : null,
    },
    categoryCount: categories.length,
    itemCount: categories.reduce((sum, category) => sum + category.items.length, 0),
    categories,
  };
}

function parseItemResponse(itemPage: unknown, restaurantId: string): ItemResult {
  const root = asObject(itemPage);
  const itemHeader = asObject(root.itemHeader);
  const optionLists = Array.isArray(root.optionLists) ? root.optionLists : [];
  const parsedOptionLists = optionLists.map(parseOptionList);

  return {
    success: true,
    restaurantId,
    item: {
      id: typeof itemHeader.id === "string" ? itemHeader.id : null,
      name: typeof itemHeader.name === "string" ? itemHeader.name : null,
      description: typeof itemHeader.description === "string" ? itemHeader.description : null,
      displayPrice: typeof itemHeader.displayString === "string" ? itemHeader.displayString : null,
      unitAmount: typeof itemHeader.unitAmount === "number" ? itemHeader.unitAmount : null,
      currency: typeof itemHeader.currency === "string" ? itemHeader.currency : null,
      decimalPlaces: typeof itemHeader.decimalPlaces === "number" ? itemHeader.decimalPlaces : null,
      menuId: typeof itemHeader.menuId === "string" ? itemHeader.menuId : null,
      specialInstructionsMaxLength:
        typeof itemHeader.specialInstructionsMaxLength === "number" ? itemHeader.specialInstructionsMaxLength : null,
      dietaryTags: Array.isArray(itemHeader.dietaryTagsList)
        ? itemHeader.dietaryTagsList.map((tag) => {
            const object = asObject(tag);
            return {
              type: typeof object.type === "string" ? object.type : null,
              abbreviatedTagDisplayString:
                typeof object.abbreviatedTagDisplayString === "string" ? object.abbreviatedTagDisplayString : null,
              fullTagDisplayString:
                typeof object.fullTagDisplayString === "string" ? object.fullTagDisplayString : null,
            };
          })
        : [],
      reviewData: root.itemHeader
        ? {
            ratingDisplayString: asObject(itemHeader.reviewData).ratingDisplayString ?? null,
            reviewCount: asObject(itemHeader.reviewData).reviewCount ?? null,
            itemReviewRankingCount:
              typeof asObject(itemHeader.reviewData).itemReviewRankingCount === "number"
                ? asObject(itemHeader.reviewData).itemReviewRankingCount
                : null,
          }
        : null,
      requiredOptionLists: parsedOptionLists.filter((group) => group.minNumOptions > 0 && !group.isOptional),
      optionLists: parsedOptionLists,
      preferences: Array.isArray(root.itemPreferences) ? root.itemPreferences : [],
    },
  };
}

function parseCartResponse(cartRoot: unknown | null): CartResult {
  const cart = cartRoot ? asObject(cartRoot) : {};
  const orders = Array.isArray(cart.orders) ? cart.orders : [];
  const items = orders.flatMap((order) => {
    const orderItems = Array.isArray(asObject(order).orderItems) ? asObject(order).orderItems : [];
    return orderItems.map((item: unknown) => {
      const object = asObject(item);
      return {
        cartItemId: typeof object.id === "string" ? object.id : "",
        itemId: asObject(object.item).id ?? null,
        name: asObject(object.item).name ?? null,
        quantity: typeof object.quantity === "number" ? object.quantity : 0,
        specialInstructions: typeof object.specialInstructions === "string" ? object.specialInstructions : object.specialInstructions ?? null,
        priceDisplayString: typeof object.priceDisplayString === "string" ? object.priceDisplayString : null,
        singlePrice: typeof object.singlePrice === "number" ? object.singlePrice : null,
        totalPrice: typeof object.priceOfTotalQuantity === "number" ? object.priceOfTotalQuantity : null,
        status: typeof object.cartItemStatusType === "string" ? object.cartItemStatusType : null,
        options: Array.isArray(object.options)
          ? object.options.map((option) => {
              const optionObject = asObject(option);
              return {
                id: typeof optionObject.id === "string" ? optionObject.id : "",
                name: typeof optionObject.name === "string" ? optionObject.name : null,
                quantity: typeof optionObject.quantity === "number" ? optionObject.quantity : null,
              };
            })
          : [],
      } satisfies CartItemResult;
    });
  });

  return {
    success: true,
    cartId: typeof cart.id === "string" ? cart.id : null,
    subtotal: typeof cart.subtotal === "number" ? cart.subtotal : null,
    total: typeof cart.total === "number" ? cart.total : null,
    currencyCode: typeof cart.currencyCode === "string" ? cart.currencyCode : null,
    restaurant: cart.restaurant
      ? {
          id: asObject(cart.restaurant).id ?? null,
          name: asObject(cart.restaurant).name ?? null,
          slug: asObject(cart.restaurant).slug ?? null,
          businessName: asObject(asObject(cart.restaurant).business).name ?? null,
        }
      : null,
    menu: cart.menu
      ? {
          id: asObject(cart.menu).id ?? null,
          name: asObject(cart.menu).name ?? null,
        }
      : null,
    itemCount: items.length,
    items,
  };
}

function parseOptionList(optionList: unknown): ItemOptionListResult {
  const object = asObject(optionList);
  const options = Array.isArray(object.options) ? object.options : [];

  return {
    id: typeof object.id === "string" ? object.id : "",
    name: typeof object.name === "string" ? object.name : "",
    subtitle: typeof object.subtitle === "string" ? object.subtitle : null,
    minNumOptions: typeof object.minNumOptions === "number" ? object.minNumOptions : 0,
    maxNumOptions: typeof object.maxNumOptions === "number" ? object.maxNumOptions : 0,
    numFreeOptions: typeof object.numFreeOptions === "number" ? object.numFreeOptions : 0,
    isOptional: Boolean(object.isOptional),
    options: options.map((option) => {
      const optionObject = asObject(option);
      return {
        id: typeof optionObject.id === "string" ? optionObject.id : "",
        name: typeof optionObject.name === "string" ? optionObject.name : "",
        displayPrice: typeof optionObject.displayString === "string" ? optionObject.displayString : null,
        unitAmount: typeof optionObject.unitAmount === "number" ? optionObject.unitAmount : null,
        defaultQuantity: typeof optionObject.defaultQuantity === "number" ? optionObject.defaultQuantity : null,
        nextCursor: typeof optionObject.nextCursor === "string" ? optionObject.nextCursor : null,
      } satisfies ItemOptionResult;
    }),
  };
}

function parseMenuItem(item: unknown): MenuItemSummary | null {
  const object = asObject(item);
  if (typeof object.id !== "string" || typeof object.name !== "string") {
    return null;
  }

  return {
    id: object.id,
    name: object.name,
    description: typeof object.description === "string" ? object.description : null,
    displayPrice: typeof object.displayPrice === "string" ? object.displayPrice : null,
    imageUrl: typeof object.imageUrl === "string" ? object.imageUrl : null,
    nextCursor: typeof object.nextCursor === "string" ? object.nextCursor : null,
    storeId: typeof object.storeId === "string" ? object.storeId : null,
  };
}

async function resolveMenuItem(restaurantId: string, itemId?: string, itemName?: string) {
  const menu = await getMenuDirect(restaurantId);
  const allItems = dedupeBy(
    menu.categories.flatMap((category) => category.items),
    (item) => item.id,
  );

  const resolved = itemId
    ? allItems.find((item) => item.id === itemId)
    : resolveMenuItemByName(allItems, itemName ?? "");

  if (!resolved) {
    throw new Error(itemId ? `Could not find item ${itemId} in restaurant ${restaurantId}.` : `Could not find item named \"${itemName}\".`);
  }

  const itemDetail = await getItemDirect(restaurantId, resolved.id);
  return { item: resolved, itemDetail };
}

function resolveMenuItemByName(items: MenuItemSummary[], itemName: string): MenuItemSummary | undefined {
  const normalized = normalizeItemName(itemName);
  const exactMatches = items.filter((item) => normalizeItemName(item.name) === normalized);

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (exactMatches.length > 1) {
    throw new Error(
      `Multiple items matched \"${itemName}\". Use --item-id instead. Matching item IDs: ${exactMatches.map((item) => item.id).join(", ")}`,
    );
  }

  const fuzzyMatches = items.filter((item) => normalizeItemName(item.name).includes(normalized));
  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0];
  }

  if (fuzzyMatches.length > 1) {
    throw new Error(
      `Multiple items partially matched \"${itemName}\". Use --item-id instead. Matching item IDs: ${fuzzyMatches.map((item) => item.id).join(", ")}`,
    );
  }

  return undefined;
}

function parseGraphQlResponse<T>(operationName: string, status: number, text: string): T {
  const parsed = safeJsonParse<GraphQlEnvelope<T>>(text);
  if (!parsed) {
    throw new Error(
      `DoorDash ${operationName} returned HTTP ${status} with a non-JSON response. This usually means the stored session or anti-bot state needs to be refreshed. Response snippet: ${truncate(
        text,
        240,
      )}`,
    );
  }

  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const message = parsed.errors.map((error) => error.message ?? "Unknown GraphQL error").join("; ");
    throw new Error(`DoorDash ${operationName} failed: ${message}`);
  }

  if (!parsed.data) {
    throw new Error(`DoorDash ${operationName} returned no data.`);
  }

  return parsed.data;
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function safeJsonParse<T>(value: string | undefined): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractStoreId(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const match = url.match(/\/(?:convenience\/)?store\/(\d+)(?:\/|\?|$)/);
  return match?.[1] ?? null;
}

function extractIdFromFacetId(value: string): string | null {
  const match = value.match(/row\.store:(?:ad_)?(\d+):/);
  return match?.[1] ?? null;
}

function parseCuisineDescription(description: string | null): string[] {
  if (!description) {
    return [];
  }

  return description
    .split("•")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^\$+$/.test(part));
}

function dedupeBy<T>(values: T[], keyFn: (value: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length)}...`;
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(dirname(getCookiesPath()), { recursive: true });
}

async function hasStorageState(): Promise<boolean> {
  try {
    await readFile(getStorageStatePath(), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function readStoredCookies(): Promise<Cookie[]> {
  try {
    const raw = await readFile(getCookiesPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Cookie[]) : [];
  } catch {
    return [];
  }
}

export function getStorageStatePath(): string {
  return join(dirname(getCookiesPath()), "storage-state.json");
}
