import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
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

const GET_AVAILABLE_ADDRESSES_QUERY = `query getAvailableAddresses {
  getAvailableAddresses {
    id
    addressId
    street
    city
    subpremise
    state
    zipCode
    country
    countryCode
    lat
    lng
    districtId
    manualLat
    manualLng
    timezone
    shortname
    printableAddress
    driverInstructions
    buildingName
    entryCode
    addressLinkType
    formattedAddressSegmentedList
    formattedAddressSegmentedNonUserEditableFieldsList
    personalAddressLabel {
      labelIcon
      labelName
    }
    dropoffPreferences {
      allPreferences {
        optionId
        isDefault
        instructions
      }
    }
  }
}`;

const ADD_CONSUMER_ADDRESS_MUTATION = `mutation addConsumerAddressV2(
  $lat: Float!
  $lng: Float!
  $city: String!
  $state: String!
  $zipCode: String!
  $printableAddress: String!
  $shortname: String!
  $googlePlaceId: String!
  $subpremise: String
  $driverInstructions: String
  $dropoffOptionId: String
  $manualLat: Float
  $manualLng: Float
  $addressLinkType: AddressLinkType
  $buildingName: String
  $entryCode: String
  $personalAddressLabel: PersonalAddressLabelInput
  $addressId: String
) {
  addConsumerAddressV2(
    lat: $lat
    lng: $lng
    city: $city
    state: $state
    zipCode: $zipCode
    printableAddress: $printableAddress
    shortname: $shortname
    googlePlaceId: $googlePlaceId
    subpremise: $subpremise
    driverInstructions: $driverInstructions
    dropoffOptionId: $dropoffOptionId
    manualLat: $manualLat
    manualLng: $manualLng
    addressLinkType: $addressLinkType
    buildingName: $buildingName
    entryCode: $entryCode
    personalAddressLabel: $personalAddressLabel
    addressId: $addressId
  ) {
    defaultAddress {
      id
      addressId
      printableAddress
      shortname
      zipCode
      submarketId
    }
    availableAddresses {
      id
      addressId
      printableAddress
      shortname
    }
  }
}`;

const UPDATE_CONSUMER_DEFAULT_ADDRESS_MUTATION = `mutation updateConsumerDefaultAddressV2($defaultAddressId: ID!) {
  updateConsumerDefaultAddressV2(defaultAddressId: $defaultAddressId) {
    defaultAddress {
      id
      addressId
      printableAddress
      shortname
      zipCode
      submarketId
    }
    availableAddresses {
      id
      addressId
      printableAddress
      shortname
    }
    orderCart {
      id
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

export type RequestedOptionSelection = {
  groupId: string;
  optionId: string;
  quantity?: number;
  children?: RequestedOptionSelection[];
};

export type BuiltNestedOption = {
  id: string;
  quantity: number;
  options: BuiltNestedOption[];
  itemExtraOption: {
    id: string;
    name: string;
    chargeAbove: number;
    defaultQuantity: number;
    description?: string;
    price?: number;
    itemExtraName?: null;
    itemExtraId?: string;
    itemExtraNumFreeOptions?: number;
    menuItemExtraOptionPrice?: number;
    menuItemExtraOptionBasePrice?: null;
  };
};

export type SetAddressResult = {
  success: true;
  mode: "direct-saved-address" | "direct-added-address";
  requestedAddress: string;
  matchedAddressId: string;
  matchedAddressSource: "saved-address" | "autocomplete-address-id" | "autocomplete-text" | "add-consumer-address";
  printableAddress: string | null;
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
  lowPriorityBatchAddCartItemInput: Array<{
    cartId: string;
    storeId: string;
    menuId: string;
    itemId: string;
    itemName: string;
    currency: string;
    quantity: number;
    unitPrice: number;
    isBundle: boolean;
    bundleType: string;
    nestedOptions: string;
  }>;
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

type BuiltLowPriorityItem = {
  storeId: string;
  menuId: string;
  itemId: string;
  itemName: string;
  currency: string;
  quantity: number;
  unitPrice: number;
  nestedOptions: BuiltNestedOption[];
};

type BuiltOptionPayload = {
  nestedOptions: BuiltNestedOption[];
  lowPriorityItems: BuiltLowPriorityItem[];
};

type NestedOptionListsResolver = (input: {
  restaurantId: string;
  consumerId: string | null;
  option: ItemOptionResult;
  group: ItemOptionListResult;
  selection: RequestedOptionSelection;
}) => Promise<ItemOptionListResult[]>;

type AddConsumerAddressPayload = {
  lat: number;
  lng: number;
  city: string;
  state: string;
  zipCode: string;
  printableAddress: string;
  shortname: string;
  googlePlaceId: string;
  subpremise: null;
  driverInstructions: null;
  dropoffOptionId: null;
  manualLat: null;
  manualLng: null;
  addressLinkType: "ADDRESS_LINK_TYPE_UNSPECIFIED";
  buildingName: null;
  entryCode: null;
  personalAddressLabel: null;
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

type AvailableAddressGraph = {
  id?: string | null;
  addressId?: string | null;
  street?: string | null;
  city?: string | null;
  subpremise?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  countryCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  districtId?: number | null;
  manualLat?: number | null;
  manualLng?: number | null;
  timezone?: string | null;
  shortname?: string | null;
  printableAddress?: string | null;
  driverInstructions?: string | null;
  buildingName?: string | null;
  entryCode?: string | null;
  addressLinkType?: string | null;
  formattedAddressSegmentedList?: string[] | null;
  formattedAddressSegmentedNonUserEditableFieldsList?: string[] | null;
};

type UpdateConsumerDefaultAddressGraph = {
  defaultAddress?: {
    id?: string | null;
    addressId?: string | null;
    printableAddress?: string | null;
    shortname?: string | null;
    zipCode?: string | null;
    submarketId?: number | null;
  } | null;
  availableAddresses?: AvailableAddressGraph[] | null;
};

type AddConsumerAddressGraph = {
  defaultAddress?: {
    id?: string | null;
    addressId?: string | null;
    printableAddress?: string | null;
    shortname?: string | null;
    zipCode?: string | null;
    submarketId?: number | null;
  } | null;
  availableAddresses?: AvailableAddressGraph[] | null;
};

type AddressAutocompletePrediction = {
  lat?: number | null;
  lng?: number | null;
  formatted_address?: string | null;
  formatted_address_short?: string | null;
  formatted_address_segmented?: string[] | null;
  formatted_address_segmented_non_user_editable_fields?: string[] | null;
  country_shortname?: string | null;
  source_place_id?: string | null;
  geo_address_id?: string | null;
  postal_code?: string | null;
  postal_code_suffix?: string | null;
  administrative_area_level1?: string | null;
  locality?: string | null;
  street_address?: string | null;
};

type AddressAutocompleteResponse = {
  predictions?: AddressAutocompletePrediction[] | null;
};

type GeoAddressResponse = {
  address?: {
    id?: string | null;
    formatted_address?: string | null;
    formatted_address_short?: string | null;
    street_address?: string | null;
    locality?: string | null;
    administrative_area_level1?: string | null;
    postal_code?: string | null;
    country_shortname?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null;
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
  private attemptedManagedImport = false;

  async init(options: DirectBrowserOptions = {}): Promise<Page> {
    if (this.page) {
      return this.page;
    }

    await this.maybeImportManagedBrowserSession();

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
    const raw = await this.requestRaw({
      url: `${BASE_URL}/graphql/${operationName}?operation=${operationName}`,
      method: "POST",
      headers: GRAPHQL_HEADERS,
      body: JSON.stringify({ operationName, variables, query }),
    });

    return parseGraphQlResponse<T>(operationName, raw.status, raw.text);
  }

  async requestJson<T>(input: {
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    operationName?: string;
  }): Promise<T> {
    const raw = await this.requestRaw(input);
    const parsed = safeJsonParse<T>(raw.text);
    if (!parsed) {
      const label = input.operationName ?? input.url;
      throw new Error(`DoorDash ${label} returned HTTP ${raw.status} with a non-JSON response. Response snippet: ${truncate(raw.text, 240)}`);
    }

    return parsed;
  }

  async saveState(): Promise<void> {
    if (!this.context) {
      return;
    }

    await saveContextState(this.context);
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => {});
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  private async requestRaw(input: {
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; text: string }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const page = await this.init();
      try {
        return await page.evaluate(
          async ({ targetUrl, method, headers, body }) => {
            const response = await fetch(targetUrl, {
              method,
              headers,
              body,
            });

            return {
              status: response.status,
              text: await response.text(),
            };
          },
          {
            targetUrl: input.url,
            method: input.method ?? "GET",
            headers: input.headers ?? {},
            body: input.body,
          },
        );
      } catch (error) {
        if (attempt === 1 || !isRetryablePageEvaluateError(error)) {
          throw error;
        }

        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(500).catch(() => {});
      }
    }

    throw new Error(`DoorDash request failed for ${input.url}`);
  }

  private async maybeImportManagedBrowserSession(): Promise<void> {
    if (this.attemptedManagedImport) {
      return;
    }

    this.attemptedManagedImport = true;
    await importManagedBrowserSessionIfAvailable().catch(() => {});
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

export async function setAddressDirect(address: string): Promise<SetAddressResult> {
  const requestedAddress = address.trim();
  if (!requestedAddress) {
    throw new Error("Missing required address text.");
  }

  const availableAddresses = await getAvailableAddressesDirect();
  const directMatch = resolveAvailableAddressMatch({
    input: requestedAddress,
    availableAddresses,
  });
  if (directMatch) {
    return updateConsumerDefaultAddressDirect(requestedAddress, directMatch);
  }

  const autocomplete = await autocompleteAddressDirect(requestedAddress);
  const prediction = autocomplete[0];
  if (!prediction) {
    throw new Error(`DoorDash returned no address predictions for "${requestedAddress}".`);
  }

  const createdAddress = await getOrCreateAddressDirect(prediction);
  const autocompleteMatch = resolveAvailableAddressMatch({
    input: requestedAddress,
    availableAddresses,
    prediction,
    createdAddress,
  });
  if (autocompleteMatch) {
    return updateConsumerDefaultAddressDirect(requestedAddress, autocompleteMatch);
  }

  const enrollmentPayload = buildAddConsumerAddressPayload({
    requestedAddress,
    prediction,
    createdAddress,
  });
  return addConsumerAddressDirect(requestedAddress, enrollmentPayload);
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
  optionSelections?: RequestedOptionSelection[];
}): Promise<AddToCartResult> {
  const { item, itemDetail } = await resolveMenuItem(params.restaurantId, params.itemId, params.itemName);
  const currentCart = await getCartDirect();
  const auth = await checkAuthDirect();

  const payload = await buildAddToCartPayload({
    restaurantId: params.restaurantId,
    cartId: currentCart.cartId ?? "",
    quantity: params.quantity,
    specialInstructions: params.specialInstructions ?? null,
    optionSelections: params.optionSelections ?? [],
    item,
    itemDetail,
    consumerId: auth.consumerId,
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

export async function buildAddToCartPayload(input: {
  restaurantId: string;
  cartId: string;
  quantity: number;
  specialInstructions: string | null;
  optionSelections?: RequestedOptionSelection[];
  item: MenuItemSummary;
  itemDetail: ItemResult;
  consumerId?: string | null;
  resolveNestedOptionLists?: NestedOptionListsResolver;
}): Promise<AddToCartPayload> {
  const header = input.itemDetail.item;
  if (!header.id || !header.name || !header.menuId || header.unitAmount == null || !header.currency) {
    throw new Error("DoorDash item details were incomplete; cannot build a cart mutation safely.");
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error(`Invalid quantity: ${input.quantity}`);
  }

  const resolveNestedOptionLists =
    input.resolveNestedOptionLists ??
    (async ({ restaurantId, consumerId, option }) => fetchNestedOptionListsDirect({ restaurantId, consumerId, option }));

  const builtOptions = await buildNestedOptionsPayload({
    restaurantId: input.restaurantId,
    menuId: header.menuId,
    currency: header.currency,
    consumerId: input.consumerId ?? null,
    optionLists: input.itemDetail.item.optionLists,
    selections: input.optionSelections ?? [],
    mode: "regular",
    resolveNestedOptionLists,
  });

  return {
    addCartItemInput: {
      storeId: input.restaurantId,
      menuId: header.menuId,
      itemId: header.id,
      itemName: header.name,
      itemDescription: header.description,
      currency: header.currency,
      quantity: input.quantity,
      nestedOptions: JSON.stringify(builtOptions.nestedOptions),
      specialInstructions: input.specialInstructions,
      substitutionPreference: "substitute",
      isBundle: false,
      bundleType: "BUNDLE_TYPE_UNSPECIFIED",
      unitPrice: header.unitAmount,
      cartId: input.cartId,
    },
    lowPriorityBatchAddCartItemInput: builtOptions.lowPriorityItems.map((item) => ({
      cartId: input.cartId,
      storeId: item.storeId,
      menuId: item.menuId,
      itemId: item.itemId,
      itemName: item.itemName,
      currency: item.currency,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      isBundle: false,
      bundleType: "BUNDLE_TYPE_UNSPECIFIED",
      nestedOptions: JSON.stringify(item.nestedOptions),
    })),
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

export function parseOptionSelectionsJson(value: string): RequestedOptionSelection[] {
  const parsed = safeJsonParse<unknown>(value);
  if (!Array.isArray(parsed)) {
    throw new Error("--options-json must be a JSON array of { groupId, optionId, quantity?, children? } objects.");
  }

  return parsed.map((entry, index) => parseRequestedOptionSelection(entry, `index ${index}`));
}

async function buildNestedOptionsPayload(input: {
  restaurantId: string;
  menuId: string;
  currency: string;
  consumerId: string | null;
  optionLists: ItemOptionListResult[];
  selections: RequestedOptionSelection[];
  mode: "regular" | "standalone-child";
  resolveNestedOptionLists: NestedOptionListsResolver;
}): Promise<BuiltOptionPayload> {
  const selections = normalizeRequestedOptionSelections(input.selections);
  const requiredGroups = input.optionLists.filter((group) => group.minNumOptions > 0 && !group.isOptional);

  if (selections.length === 0) {
    if (requiredGroups.length === 0) {
      return { nestedOptions: [], lowPriorityItems: [] };
    }

    const labels = requiredGroups.map((group) => `${group.name} (${group.minNumOptions}-${group.maxNumOptions})`);
    throw new Error(
      `This item has required option groups. Provide --options-json with validated groupId/optionId selections. Required groups: ${labels.join(", ")}`,
    );
  }

  const groupsById = new Map(input.optionLists.map((group) => [group.id, group]));
  const selectionsByGroup = new Map<
    string,
    Array<{ selection: RequestedOptionSelection; option: ItemOptionResult; quantity: number; group: ItemOptionListResult }>
  >();

  for (const selection of selections) {
    const group = groupsById.get(selection.groupId);
    if (!group) {
      throw new Error(`Unknown option group: ${selection.groupId}`);
    }

    const option = group.options.find((candidate) => candidate.id === selection.optionId);
    if (!option) {
      throw new Error(`Unknown option ${selection.optionId} for group ${group.name} (${group.id}).`);
    }

    const entries = selectionsByGroup.get(group.id) ?? [];
    entries.push({ selection, option, quantity: selection.quantity ?? 1, group });
    selectionsByGroup.set(group.id, entries);
  }

  validateSelectedOptionCounts(input.optionLists, selectionsByGroup);

  const nestedOptions: BuiltNestedOption[] = [];
  const lowPriorityItems: BuiltLowPriorityItem[] = [];

  for (const group of input.optionLists) {
    const selectedEntries = selectionsByGroup.get(group.id) ?? [];
    for (const { selection, option, quantity } of selectedEntries) {
      if (!option.nextCursor) {
        if (selection.children && selection.children.length > 0) {
          throw new Error(
            `Option ${option.name} (${option.id}) does not open a nested configuration step, so child selections are invalid.`,
          );
        }

        nestedOptions.push(
          input.mode === "standalone-child"
            ? buildStandaloneChildLeafOption({ option, quantity })
            : buildRegularLeafOption({ option, quantity, group }),
        );
        continue;
      }

      if (!isStandaloneRecommendedGroup(group)) {
        throw new Error(
          `Option ${option.name} (${option.id}) opens an additional nested configuration step, but DoorDash's safe direct cart shape is only confirmed for standalone recommended add-on groups (recommended_option_*). Group ${group.id} does not match that transport, so the CLI refuses to guess.`,
        );
      }

      const childOptionLists = await input.resolveNestedOptionLists({
        restaurantId: input.restaurantId,
        consumerId: input.consumerId,
        option,
        group,
        selection,
      });

      const childPayload = await buildNestedOptionsPayload({
        restaurantId: input.restaurantId,
        menuId: input.menuId,
        currency: input.currency,
        consumerId: input.consumerId,
        optionLists: childOptionLists,
        selections: selection.children ?? [],
        mode: "standalone-child",
        resolveNestedOptionLists: input.resolveNestedOptionLists,
      });

      lowPriorityItems.push({
        storeId: input.restaurantId,
        menuId: input.menuId,
        itemId: option.id,
        itemName: option.name,
        currency: input.currency,
        quantity,
        unitPrice: option.unitAmount ?? 0,
        nestedOptions: childPayload.nestedOptions,
      });
      lowPriorityItems.push(...childPayload.lowPriorityItems);
    }
  }

  return {
    nestedOptions,
    lowPriorityItems,
  };
}

function buildRegularLeafOption(input: {
  option: ItemOptionResult;
  quantity: number;
  group: ItemOptionListResult;
}): BuiltNestedOption {
  return {
    id: input.option.id,
    quantity: input.quantity,
    options: [],
    itemExtraOption: {
      id: input.option.id,
      name: input.option.name,
      description: input.option.name,
      price: input.option.unitAmount ?? 0,
      itemExtraName: null,
      chargeAbove: 0,
      defaultQuantity: input.option.defaultQuantity ?? 0,
      itemExtraId: input.group.id,
      itemExtraNumFreeOptions: input.group.numFreeOptions,
      menuItemExtraOptionPrice: input.option.unitAmount ?? 0,
      menuItemExtraOptionBasePrice: null,
    },
  };
}

function buildStandaloneChildLeafOption(input: { option: ItemOptionResult; quantity: number }): BuiltNestedOption {
  return {
    id: input.option.id,
    quantity: input.quantity,
    options: [],
    itemExtraOption: {
      id: input.option.id,
      name: input.option.name,
      description: input.option.name,
      price: input.option.unitAmount ?? 0,
      chargeAbove: 0,
      defaultQuantity: input.option.defaultQuantity ?? 0,
    },
  };
}

function validateSelectedOptionCounts(
  optionLists: ItemOptionListResult[],
  selectionsByGroup: Map<string, Array<{ quantity: number }>>,
): void {
  for (const group of optionLists) {
    const selectedEntries = selectionsByGroup.get(group.id) ?? [];
    const selectedCount = selectedEntries.reduce((sum, entry) => sum + entry.quantity, 0);

    if (selectedCount < group.minNumOptions) {
      throw new Error(`Missing required selections for ${group.name}. Need at least ${group.minNumOptions}.`);
    }

    if (group.maxNumOptions > 0 && selectedCount > group.maxNumOptions) {
      throw new Error(`Too many selections for ${group.name}. Maximum is ${group.maxNumOptions}.`);
    }
  }
}

function isStandaloneRecommendedGroup(group: ItemOptionListResult): boolean {
  return group.id.startsWith("recommended_option_");
}

function parseRequestedOptionSelection(entry: unknown, label: string): RequestedOptionSelection {
  const object = asObject(entry);
  const groupId = typeof object.groupId === "string" ? object.groupId.trim() : "";
  const optionId = typeof object.optionId === "string" ? object.optionId.trim() : "";
  const quantity = object.quantity == null ? undefined : Number.parseInt(String(object.quantity), 10);
  const childrenRaw = object.children;

  if (!groupId || !optionId) {
    throw new Error(`Invalid option selection at ${label}. Each entry must include string groupId and optionId fields.`);
  }
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
    throw new Error(`Invalid option quantity at ${label}: ${object.quantity}`);
  }
  if (childrenRaw !== undefined && !Array.isArray(childrenRaw)) {
    throw new Error(`Invalid option children at ${label}. children must be an array when provided.`);
  }

  const children = Array.isArray(childrenRaw)
    ? childrenRaw.map((child, index) => parseRequestedOptionSelection(child, `${label}.children[${index}]`))
    : undefined;

  return {
    groupId,
    optionId,
    ...(quantity === undefined ? {} : { quantity }),
    ...(children === undefined ? {} : { children }),
  } satisfies RequestedOptionSelection;
}

function normalizeRequestedOptionSelections(selections: RequestedOptionSelection[]): RequestedOptionSelection[] {
  const aggregated = new Map<string, RequestedOptionSelection>();

  for (const selection of selections) {
    const groupId = selection.groupId.trim();
    const optionId = selection.optionId.trim();
    const quantity = selection.quantity ?? 1;
    const children = selection.children ? normalizeRequestedOptionSelections(selection.children) : undefined;

    if (!groupId || !optionId) {
      throw new Error("Option selections must include non-empty groupId and optionId values.");
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`Invalid option quantity for ${groupId}/${optionId}: ${selection.quantity}`);
    }

    const key = `${groupId}:${optionId}`;
    const previous = aggregated.get(key);
    if (previous) {
      if ((previous.children && previous.children.length > 0) || (children && children.length > 0)) {
        throw new Error(
          `Duplicate option selections for ${groupId}/${optionId} are only supported when no nested child selections are attached.`,
        );
      }
      aggregated.set(key, { ...previous, quantity: (previous.quantity ?? 1) + quantity });
    } else {
      aggregated.set(key, { groupId, optionId, quantity, ...(children ? { children } : {}) });
    }
  }

  return [...aggregated.values()];
}

async function fetchNestedOptionListsDirect(input: {
  restaurantId: string;
  consumerId: string | null;
  option: ItemOptionResult;
}): Promise<ItemOptionListResult[]> {
  if (!input.option.nextCursor) {
    return [];
  }

  const data = await session.graphql<{ itemPage?: unknown }>("itemPage", ITEM_QUERY, {
    storeId: input.restaurantId,
    itemId: input.option.id,
    consumerId: input.consumerId,
    isMerchantPreview: false,
    isNested: true,
    fulfillmentType: "Delivery",
    cursorContext: {
      itemCursor: input.option.nextCursor,
    },
  });

  const root = asObject(data.itemPage);
  const optionLists = Array.isArray(root.optionLists) ? root.optionLists : [];
  return optionLists.map(parseOptionList);
}

async function getAvailableAddressesDirect(): Promise<AvailableAddressGraph[]> {
  const data = await session.graphql<{ getAvailableAddresses?: AvailableAddressGraph[] | null }>(
    "getAvailableAddresses",
    GET_AVAILABLE_ADDRESSES_QUERY,
    {},
  );
  return Array.isArray(data.getAvailableAddresses) ? data.getAvailableAddresses : [];
}

async function autocompleteAddressDirect(inputAddress: string): Promise<AddressAutocompletePrediction[]> {
  const params = new URLSearchParams({
    input_address: inputAddress,
    autocomplete_type: "AUTOCOMPLETE_TYPE_V2_UNSPECIFIED",
  });
  const response = await session.requestJson<AddressAutocompleteResponse>({
    url: `${BASE_URL}/unified-gateway/geo-intelligence/v2/address/autocomplete?${params.toString()}`,
    method: "GET",
    headers: { accept: "application/json" },
    operationName: "address autocomplete",
  });
  return Array.isArray(response.predictions) ? response.predictions : [];
}

async function getOrCreateAddressDirect(prediction: AddressAutocompletePrediction): Promise<GeoAddressResponse["address"]> {
  const sourcePlaceId = prediction.source_place_id?.trim();
  if (!sourcePlaceId) {
    throw new Error("DoorDash autocomplete did not return a source_place_id for the selected address.");
  }

  const response = await session.requestJson<GeoAddressResponse>({
    url: `${BASE_URL}/unified-gateway/geo-intelligence/v2/address/get-or-create`,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      address_identifier: {
        _type: "source_place_id_request",
        source_place_id: sourcePlaceId,
      },
    }),
    operationName: "address get-or-create",
  });

  return response.address ?? null;
}

export function buildAddConsumerAddressPayload(input: {
  requestedAddress: string;
  prediction: AddressAutocompletePrediction;
  createdAddress: GeoAddressResponse["address"];
}): AddConsumerAddressPayload {
  const createdAddress = input.createdAddress;
  const lat = typeof createdAddress?.lat === "number" ? createdAddress.lat : input.prediction.lat;
  const lng = typeof createdAddress?.lng === "number" ? createdAddress.lng : input.prediction.lng;
  const city = firstNonEmptyString(createdAddress?.locality, input.prediction.locality);
  const state = firstNonEmptyString(createdAddress?.administrative_area_level1, input.prediction.administrative_area_level1);
  const zipCode = firstNonEmptyString(createdAddress?.postal_code, combinePostalCode(input.prediction));
  const printableAddress = firstNonEmptyString(
    createdAddress?.formatted_address,
    input.prediction.formatted_address,
    input.requestedAddress,
  );
  const shortname = firstNonEmptyString(
    createdAddress?.formatted_address_short,
    input.prediction.formatted_address_short,
    input.requestedAddress,
  );
  const googlePlaceId = firstNonEmptyString(input.prediction.source_place_id);

  if (typeof lat !== "number" || typeof lng !== "number") {
    throw new Error(`DoorDash did not return stable coordinates for "${input.requestedAddress}".`);
  }
  if (!city || !state || !zipCode || !printableAddress || !shortname || !googlePlaceId) {
    throw new Error(
      `DoorDash resolved "${input.requestedAddress}", but the addConsumerAddressV2 payload was incomplete. city=${city ?? ""} state=${state ?? ""} zip=${zipCode ?? ""} shortname=${shortname ?? ""} googlePlaceId=${googlePlaceId ? "present" : "missing"}`,
    );
  }

  return {
    lat,
    lng,
    city,
    state,
    zipCode,
    printableAddress,
    shortname,
    googlePlaceId,
    subpremise: null,
    driverInstructions: null,
    dropoffOptionId: null,
    manualLat: null,
    manualLng: null,
    addressLinkType: "ADDRESS_LINK_TYPE_UNSPECIFIED",
    buildingName: null,
    entryCode: null,
    personalAddressLabel: null,
  };
}

async function addConsumerAddressDirect(requestedAddress: string, payload: AddConsumerAddressPayload): Promise<SetAddressResult> {
  const data = await session.graphql<{ addConsumerAddressV2?: AddConsumerAddressGraph | null }>(
    "addConsumerAddressV2",
    ADD_CONSUMER_ADDRESS_MUTATION,
    payload,
  );

  const defaultAddress = data.addConsumerAddressV2?.defaultAddress ?? null;
  const matchedAddressId = typeof defaultAddress?.id === "string" ? defaultAddress.id : "";
  if (!matchedAddressId) {
    throw new Error(
      `DoorDash accepted addConsumerAddressV2 for "${requestedAddress}", but it did not return a saved defaultAddress id. The CLI is refusing to guess follow-up address state.`,
    );
  }

  await session.saveState();

  return {
    success: true,
    mode: "direct-added-address",
    requestedAddress,
    matchedAddressId,
    matchedAddressSource: "add-consumer-address",
    printableAddress: defaultAddress?.printableAddress ?? payload.printableAddress,
  };
}

async function updateConsumerDefaultAddressDirect(
  requestedAddress: string,
  match: { id: string; printableAddress: string | null; source: SetAddressResult["matchedAddressSource"] },
): Promise<SetAddressResult> {
  const data = await session.graphql<{ updateConsumerDefaultAddressV2?: UpdateConsumerDefaultAddressGraph | null }>(
    "updateConsumerDefaultAddressV2",
    UPDATE_CONSUMER_DEFAULT_ADDRESS_MUTATION,
    { defaultAddressId: match.id },
  );

  await session.saveState();

  return {
    success: true,
    mode: "direct-saved-address",
    requestedAddress,
    matchedAddressId: match.id,
    matchedAddressSource: match.source,
    printableAddress: data.updateConsumerDefaultAddressV2?.defaultAddress?.printableAddress ?? match.printableAddress ?? null,
  };
}

export function resolveAvailableAddressMatch(input: {
  input: string;
  availableAddresses: AvailableAddressGraph[];
  prediction?: AddressAutocompletePrediction | null;
  createdAddress?: GeoAddressResponse["address"] | null;
}): { id: string; printableAddress: string | null; source: SetAddressResult["matchedAddressSource"] } | null {
  const addressIds = [input.prediction?.geo_address_id, input.createdAddress?.id]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  for (const availableAddress of input.availableAddresses) {
    const defaultAddressId = typeof availableAddress.id === "string" ? availableAddress.id.trim() : "";
    if (!defaultAddressId) {
      continue;
    }

    if (typeof availableAddress.addressId === "string" && addressIds.includes(availableAddress.addressId.trim())) {
      return {
        id: defaultAddressId,
        printableAddress: availableAddress.printableAddress ?? null,
        source: "autocomplete-address-id",
      };
    }
  }

  const normalizedCandidates = dedupeBy(
    [
      input.input,
      input.prediction?.formatted_address ?? null,
      input.prediction?.formatted_address_short ?? null,
      input.createdAddress?.formatted_address ?? null,
      input.createdAddress?.formatted_address_short ?? null,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(normalizeAddressText),
    (value) => value,
  );

  for (const availableAddress of input.availableAddresses) {
    const defaultAddressId = typeof availableAddress.id === "string" ? availableAddress.id.trim() : "";
    if (!defaultAddressId) {
      continue;
    }

    const printableAddress = normalizeAddressText(availableAddress.printableAddress ?? "");
    const shortname = normalizeAddressText(availableAddress.shortname ?? "");
    const matchesText = normalizedCandidates.some(
      (candidate) =>
        candidate === printableAddress ||
        candidate === shortname ||
        (shortname.length > 0 && candidate.includes(shortname)) ||
        (printableAddress.length > 0 && printableAddress.includes(candidate)),
    );
    if (matchesText) {
      return {
        id: defaultAddressId,
        printableAddress: availableAddress.printableAddress ?? null,
        source: input.prediction || input.createdAddress ? "autocomplete-text" : "saved-address",
      };
    }
  }

  return null;
}

function combinePostalCode(prediction: AddressAutocompletePrediction): string | null {
  const postalCode = typeof prediction.postal_code === "string" ? prediction.postal_code.trim() : "";
  const suffix = typeof prediction.postal_code_suffix === "string" ? prediction.postal_code_suffix.trim() : "";
  if (!postalCode) {
    return null;
  }
  return suffix ? `${postalCode}-${suffix}` : postalCode;
}

function firstNonEmptyString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeAddressText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ");
}

async function importManagedBrowserSessionIfAvailable(): Promise<boolean> {
  for (const cdpUrl of await getManagedBrowserCdpCandidates()) {
    if (!(await isCdpEndpointReachable(cdpUrl))) {
      continue;
    }

    let browser: Browser | null = null;
    let tempPage: Page | null = null;
    try {
      browser = await chromium.connectOverCDP(cdpUrl);
      const context = browser.contexts()[0];
      if (!context) {
        continue;
      }

      let page = context.pages().find((candidate) => candidate.url().includes("doordash.com")) ?? null;
      if (!page) {
        tempPage = await context.newPage();
        page = tempPage;
        await page.goto(`${BASE_URL}/home`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
        await page.waitForTimeout(1_000);
      }

      const consumerData = await fetchConsumerViaPage(page);
      const consumer = consumerData.consumer ?? null;
      if (!consumer || consumer.isGuest !== false) {
        continue;
      }

      await saveContextState(context);
      return true;
    } catch {
      continue;
    } finally {
      await tempPage?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  return false;
}

async function fetchConsumerViaPage(page: Page): Promise<{ consumer: ConsumerGraph | null }> {
  const raw = await page.evaluate(
    async ({ query, headers, url }) => {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ operationName: "consumer", variables: {}, query }),
      });
      return { status: response.status, text: await response.text() };
    },
    {
      query: CONSUMER_QUERY,
      headers: GRAPHQL_HEADERS,
      url: `${BASE_URL}/graphql/consumer?operation=consumer`,
    },
  );

  return parseGraphQlResponse<{ consumer: ConsumerGraph | null }>("managedBrowserConsumerImport", raw.status, raw.text);
}

async function saveContextState(context: BrowserContext): Promise<void> {
  const storageStatePath = getStorageStatePath();
  await ensureConfigDir();
  await context.storageState({ path: storageStatePath });

  const cookies = await context.cookies();
  await writeFile(getCookiesPath(), JSON.stringify(cookies, null, 2));
}

async function getManagedBrowserCdpCandidates(): Promise<string[]> {
  const candidates = new Set<string>();
  for (const value of [
    process.env.DOORDASH_MANAGED_BROWSER_CDP_URL,
    process.env.OPENCLAW_BROWSER_CDP_URL,
    process.env.OPENCLAW_OPENCLAW_CDP_URL,
  ]) {
    if (typeof value === "string" && value.trim().length > 0) {
      candidates.add(value.trim().replace(/\/$/, ""));
    }
  }

  for (const value of await readOpenClawBrowserConfigCandidates()) {
    candidates.add(value.replace(/\/$/, ""));
  }

  candidates.add("http://127.0.0.1:18800");
  return [...candidates];
}

async function readOpenClawBrowserConfigCandidates(): Promise<string[]> {
  try {
    const raw = await readFile(join(homedir(), ".openclaw", "openclaw.json"), "utf8");
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    const browserConfig = asObject(parsed?.browser);
    const candidates: string[] = [];

    const pushCandidate = (value: unknown) => {
      const object = asObject(value);
      if (typeof object.cdpUrl === "string" && object.cdpUrl.trim()) {
        candidates.push(object.cdpUrl.trim());
      } else if (typeof object.cdpPort === "number" && Number.isInteger(object.cdpPort)) {
        candidates.push(`http://127.0.0.1:${object.cdpPort}`);
      }
    };

    pushCandidate(browserConfig);
    pushCandidate(browserConfig.openclaw);
    pushCandidate(asObject(browserConfig.profiles).openclaw);
    return dedupeBy(candidates, (value) => value);
  } catch {
    return [];
  }
}

async function isCdpEndpointReachable(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
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

function isRetryablePageEvaluateError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Execution context was destroyed|Cannot find context with specified id|Target page, context or browser has been closed/i.test(
    error.message,
  );
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
