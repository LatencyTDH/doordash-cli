import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { chromium, type Browser, type BrowserContext, type Cookie, type Page } from "playwright";
import { getBrowserImportBlockPath, getCookiesPath, getStorageStatePath } from "./session-storage.js";

const BASE_URL = "https://www.doordash.com";
const AUTH_BOOTSTRAP_URL = `${BASE_URL}/home`;
const AUTH_BOOTSTRAP_TIMEOUT_MS = 180_000;
const AUTH_BOOTSTRAP_POLL_INTERVAL_MS = 2_000;
const AUTH_BOOTSTRAP_NO_DISCOVERY_GRACE_MS = 10_000;
const ATTACHED_BROWSER_CDP_REACHABILITY_TIMEOUT_MS = 2_000;
const ATTACHED_BROWSER_CDP_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const LINUX_CHROMIUM_COOKIE_IMPORT_SCRIPT = String.raw`
import json
import os
import sqlite3
import hashlib
import sys

try:
    import secretstorage
    from Crypto.Cipher import AES
except Exception as exc:
    raise SystemExit(f"missing python support for Chromium cookie import: {exc}")

browser_label = os.environ.get("DD_BROWSER_LABEL", "Chromium")
user_data_dir = os.environ.get("DD_BROWSER_USER_DATA_DIR", "")
safe_storage_application = os.environ.get("DD_BROWSER_SAFE_STORAGE_APP", "")

if not user_data_dir or not safe_storage_application:
    raise SystemExit("missing browser metadata")


def chromium_utc_to_unix_seconds(value):
    if not value:
        return -1
    return max(-1, (int(value) / 1000000) - 11644473600)


def samesite_to_playwright(value):
    mapping = {
        -1: "Lax",
        0: "None",
        1: "Lax",
        2: "Strict",
    }
    try:
        return mapping.get(int(value), "Lax")
    except Exception:
        return "Lax"


def get_safe_storage_secret(application):
    bus = secretstorage.dbus_init()
    for collection in secretstorage.get_all_collections(bus):
        for item in collection.get_all_items():
            attrs = item.get_attributes()
            if attrs.get("xdg:schema") == "chrome_libsecret_os_crypt_password_v2" and attrs.get("application") == application:
                secret = item.get_secret()
                return secret.decode("utf-8") if isinstance(secret, bytes) else str(secret)
    return None


def decrypt_cookie_value(encrypted_value, host_key, secret):
    payload = encrypted_value[3:] if encrypted_value.startswith((b"v10", b"v11")) else encrypted_value
    key = hashlib.pbkdf2_hmac("sha1", secret.encode("utf-8"), b"saltysalt", 1, dklen=16)
    decrypted = AES.new(key, AES.MODE_CBC, b" " * 16).decrypt(payload)
    pad = decrypted[-1]
    if isinstance(pad, str):
        pad = ord(pad)
    if 1 <= pad <= 16:
        decrypted = decrypted[:-pad]
    host_hash = hashlib.sha256(host_key.encode("utf-8")).digest()
    if decrypted.startswith(host_hash):
        decrypted = decrypted[len(host_hash):]
    return decrypted.decode("utf-8")


def profile_names_for_user_data_dir(root):
    local_state_path = os.path.join(root, "Local State")
    entries = []
    try:
        with open(local_state_path, "r", encoding="utf-8") as handle:
            info_cache = ((json.load(handle).get("profile") or {}).get("info_cache") or {})
        for profile_name, info in info_cache.items():
            if not isinstance(profile_name, str) or not profile_name.strip():
                continue
            active_time = 0.0
            if isinstance(info, dict):
                try:
                    active_time = float(info.get("active_time") or 0)
                except Exception:
                    active_time = 0.0
            entries.append((0 if profile_name == "Default" else 1, -active_time, profile_name))
    except Exception:
        pass

    entries.sort()
    names = [profile_name for _, _, profile_name in entries]
    if "Default" not in names:
        names.append("Default")
    return names


safe_storage_secret = get_safe_storage_secret(safe_storage_application)
if not safe_storage_secret:
    print("[]")
    raise SystemExit(0)

imports = []
for profile_name in profile_names_for_user_data_dir(user_data_dir):
    cookies_db_path = os.path.join(user_data_dir, profile_name, "Cookies")
    if not os.path.exists(cookies_db_path):
        continue

    connection = None
    try:
        connection = sqlite3.connect(f"file:{cookies_db_path}?mode=ro", uri=True)
        cursor = connection.cursor()
        rows = cursor.execute(
            """
            select host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite
            from cookies
            where host_key like '%doordash%'
            order by host_key, name
            """
        ).fetchall()
    except Exception:
        if connection is not None:
            connection.close()
        continue

    cookies = []
    for host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite in rows:
        try:
            decrypted_value = decrypt_cookie_value(encrypted_value, host_key, safe_storage_secret)
        except Exception:
            continue
        cookies.append({
            "name": name,
            "value": decrypted_value,
            "domain": host_key,
            "path": path or "/",
            "expires": chromium_utc_to_unix_seconds(expires_utc),
            "httpOnly": bool(is_httponly),
            "secure": bool(is_secure),
            "sameSite": samesite_to_playwright(samesite),
        })

    connection.close()
    if cookies:
        imports.append({
            "browserLabel": browser_label,
            "profileName": profile_name,
            "cookies": cookies,
        })

print(json.dumps(imports))
`;

const LINUX_CHROMIUM_COOKIE_IMPORT_BROWSERS = [
  {
    browserLabel: "Brave",
    safeStorageApplication: "brave",
    userDataDirSegments: [".config", "BraveSoftware", "Brave-Browser"],
  },
  {
    browserLabel: "Google Chrome",
    safeStorageApplication: "chrome",
    userDataDirSegments: [".config", "google-chrome"],
  },
] as const;

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


const EXISTING_ORDERS_QUERY = `query getConsumerOrdersWithDetails($offset: Int!, $limit: Int!, $includeCancelled: Boolean) {
  getConsumerOrdersWithDetails(offset: $offset, limit: $limit, includeCancelled: $includeCancelled) {
    id
    orderUuid
    deliveryUuid
    createdAt
    submittedAt
    cancelledAt
    fulfilledAt
    specialInstructions
    isReorderable
    isGift
    isPickup
    isRetail
    isMerchantShipping
    containsAlcohol
    fulfillmentType
    shoppingProtocol
    orderFilterType
    pollingInterval
    creator {
      id
      firstName
      lastName
    }
    deliveryAddress {
      id
      formattedAddress
    }
    orders {
      id
      items {
        id
        name
        quantity
        specialInstructions
        substitutionPreferences
        originalItemPrice
        purchaseType
        purchaseQuantity {
          continuousQuantity {
            quantity
            unit
          }
          discreteQuantity {
            quantity
            unit
          }
        }
        fulfillQuantity {
          continuousQuantity {
            quantity
            unit
          }
          discreteQuantity {
            quantity
            unit
          }
        }
        orderItemExtras {
          menuItemExtraId
          name
          orderItemExtraOptions {
            menuExtraOptionId
            name
            description
            price
            quantity
            orderItemExtras {
              menuItemExtraId
              name
              orderItemExtraOptions {
                menuExtraOptionId
                name
                description
                price
                quantity
              }
            }
          }
        }
      }
    }
    grandTotal {
      unitAmount
      currency
      decimalPlaces
      displayString
      sign
    }
    likelyOosItems {
      menuItemId
      name
      photoUrl
    }
    store {
      id
      name
      business {
        id
        name
      }
      phoneNumber
      fulfillsOwnDeliveries
      customerArrivedPickupInstructions
      rerouteStoreId
    }
    recurringOrderDetails {
      itemNames
      consumerId
      recurringOrderUpcomingOrderUuid
      scheduledDeliveryDate
      arrivalTimeDisplayString
      storeName
      isCancelled
    }
    bundleOrderInfo {
      primaryBundleOrderUuid
      primaryBundleOrderId
      bundleOrderUuids
      bundleOrderConfig {
        bundleType
        bundleOrderRole
      }
    }
    cancellationPendingRefundInfo {
      state
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

export type AuthBootstrapResult =
  | (AuthResult & {
      success: true;
      isLoggedIn: true;
      message: string;
    })
  | (Omit<AuthResult, "success" | "isLoggedIn"> & {
      success: false;
      isLoggedIn: false;
      message: string;
    });

type ManagedBrowserLoginResult =
  | {
      status: "completed";
      completion: "automatic" | "manual";
      auth: AuthResult;
    }
  | {
      status: "timed-out";
      auth: AuthResult;
    }
  | {
      status: "launch-failed";
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


export type ExistingOrderLifecycleStatus = "draft" | "submitted" | "in-progress" | "fulfilled" | "cancelled" | "unknown";

export type ExistingOrderMoneyResult = {
  unitAmount: number | null;
  currency: string | null;
  decimalPlaces: number | null;
  displayString: string | null;
  sign: string | null;
};

export type ExistingOrderQuantityResult = {
  quantity: number | null;
  unit: string | null;
};

export type ExistingOrderExtraOptionResult = {
  menuExtraOptionId: string | null;
  name: string | null;
  description: string | null;
  price: number | null;
  quantity: number | null;
  extras: ExistingOrderExtraResult[];
};

export type ExistingOrderExtraResult = {
  menuItemExtraId: string | null;
  name: string | null;
  options: ExistingOrderExtraOptionResult[];
};

export type ExistingOrderItemResult = {
  id: string | null;
  name: string | null;
  quantity: number;
  specialInstructions: string | null;
  substitutionPreferences: string | null;
  originalItemPrice: number | null;
  purchaseType: string | null;
  purchaseQuantity: ExistingOrderQuantityResult | null;
  fulfillQuantity: ExistingOrderQuantityResult | null;
  extras: ExistingOrderExtraResult[];
};

export type ExistingOrderResult = {
  id: string | null;
  orderUuid: string | null;
  deliveryUuid: string | null;
  createdAt: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  fulfilledAt: string | null;
  lifecycleStatus: ExistingOrderLifecycleStatus;
  isActive: boolean;
  hasLiveTracking: boolean;
  pollingIntervalSeconds: number | null;
  specialInstructions: string | null;
  isReorderable: boolean;
  isGift: boolean;
  isPickup: boolean;
  isRetail: boolean;
  isMerchantShipping: boolean;
  containsAlcohol: boolean;
  fulfillmentType: string | null;
  shoppingProtocol: string | null;
  orderFilterType: string | null;
  creator: {
    id: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  deliveryAddress: {
    id: string | null;
    formattedAddress: string | null;
  } | null;
  store: {
    id: string | null;
    name: string | null;
    businessName: string | null;
    phoneNumber: string | null;
    fulfillsOwnDeliveries: boolean | null;
    customerArrivedPickupInstructions: string | null;
    rerouteStoreId: string | null;
  } | null;
  grandTotal: ExistingOrderMoneyResult | null;
  itemCount: number;
  items: ExistingOrderItemResult[];
  likelyOutOfStockItems: Array<{
    menuItemId: string | null;
    name: string | null;
    photoUrl: string | null;
  }>;
  recurringOrderDetails: {
    itemNames: string[];
    consumerId: string | null;
    recurringOrderUpcomingOrderUuid: string | null;
    scheduledDeliveryDate: string | null;
    arrivalTimeDisplayString: string | null;
    storeName: string | null;
    isCancelled: boolean | null;
  } | null;
  bundleOrderInfo: {
    primaryBundleOrderUuid: string | null;
    primaryBundleOrderId: string | null;
    bundleOrderUuids: string[];
    bundleType: string | null;
    bundleOrderRole: string | null;
  } | null;
  cancellationPendingRefundState: string | null;
};

export type OrdersResult = {
  success: true;
  source: "graphql" | "orders-page-cache";
  warning: string | null;
  count: number;
  activeCount: number;
  orders: ExistingOrderResult[];
};

export type OrderResult = {
  success: true;
  source: "graphql" | "orders-page-cache";
  warning: string | null;
  matchedField: "id" | "orderUuid" | "deliveryUuid";
  order: ExistingOrderResult;
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


type OrdersPageSnapshot = {
  cache: Record<string, unknown> | null;
  noOrdersBanner: boolean;
  turnstileOverlayVisible: boolean;
  url: string;
};

class DoorDashDirectSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private attemptedBrowserImport = false;

  async init(options: DirectBrowserOptions = {}): Promise<Page> {
    if (this.page) {
      return this.page;
    }

    await this.maybeImportBrowserSession();

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

  async ordersPageSnapshot(): Promise<OrdersPageSnapshot> {
    const page = await this.init();
    await page.goto(`${BASE_URL}/orders/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(3_000);

    return page.evaluate(() => {
      const globalWindow = window as Window & {
        __APOLLO_CLIENT__?: {
          cache?: {
            extract?: () => Record<string, unknown>;
          };
        };
      };
      const bodyText = document.body?.innerText ?? "";
      return {
        cache: globalWindow.__APOLLO_CLIENT__?.cache?.extract?.() ?? null,
        noOrdersBanner: /No orders yet/i.test(bodyText),
        turnstileOverlayVisible: Boolean(document.querySelector('[data-testid="turnstile/overlay"]')),
        url: window.location.href,
      } satisfies OrdersPageSnapshot;
    });
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

  markBrowserImportAttempted(): void {
    this.attemptedBrowserImport = true;
  }

  resetBrowserImportAttempted(): void {
    this.attemptedBrowserImport = false;
  }

  private async maybeImportBrowserSession(): Promise<void> {
    if (this.attemptedBrowserImport) {
      return;
    }

    this.attemptedBrowserImport = true;
    if (await hasBlockedBrowserImport()) {
      return;
    }

    await importBrowserSessionIfAvailable().catch(() => {});
  }
}

type BootstrapAuthSessionDeps = {
  clearBlockedBrowserImport: () => Promise<void>;
  checkPersistedAuth: () => Promise<AuthResult | null>;
  importBrowserSessionIfAvailable: () => Promise<boolean>;
  markBrowserImportAttempted: () => void;
  getAttachedBrowserCdpCandidates: () => Promise<string[]>;
  getReachableCdpCandidates: (candidates: string[]) => Promise<string[]>;
  describeDesktopBrowserReuseGap: () => Promise<string | null>;
  openUrlInAttachedBrowser: (input: { cdpUrl: string; targetUrl: string }) => Promise<boolean>;
  openUrlInDefaultBrowser: (targetUrl: string) => Promise<boolean>;
  waitForAttachedBrowserSessionImport: (input: { timeoutMs: number; pollIntervalMs: number }) => Promise<boolean>;
  waitForManagedBrowserLogin: (input: {
    targetUrl: string;
    timeoutMs: number;
    pollIntervalMs: number;
    log: (message: string) => void;
  }) => Promise<ManagedBrowserLoginResult>;
  canPromptForManagedBrowserConfirmation: () => boolean;
  checkAuthDirect: () => Promise<AuthResult>;
  log: (message: string) => void;
};

const session = new DoorDashDirectSession();

export function buildAuthResult(consumer: ConsumerGraph | null): AuthResult {
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

function buildAuthBootstrapSuccess(auth: AuthResult, message: string): AuthBootstrapResult {
  if (!auth.isLoggedIn) {
    return buildAuthBootstrapFailure(auth, message);
  }

  return {
    ...auth,
    success: true,
    isLoggedIn: true,
    message,
  };
}

function buildAuthBootstrapFailure(auth: AuthResult | null, message: string): AuthBootstrapResult {
  const base = auth ?? buildAuthResult(null);
  return {
    ...base,
    success: false,
    isLoggedIn: false,
    message,
  };
}

function canPromptForManagedBrowserConfirmation(): boolean {
  return Boolean(process.stdin.isTTY);
}

type ManagedBrowserManualConfirmationHandle = {
  isEnabled: boolean;
  consumeRequested: () => boolean;
  close: () => void;
};

function createManagedBrowserManualConfirmationHandle(): ManagedBrowserManualConfirmationHandle {
  if (!canPromptForManagedBrowserConfirmation()) {
    return {
      isEnabled: false,
      consumeRequested: () => false,
      close: () => {},
    };
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  let requested = false;
  const onLine = () => {
    requested = true;
  };
  rl.on("line", onLine);

  return {
    isEnabled: true,
    consumeRequested: () => {
      if (!requested) {
        return false;
      }

      requested = false;
      return true;
    },
    close: () => {
      rl.off("line", onLine);
      rl.close();
    },
  };
}

export async function checkAuthDirect(): Promise<AuthResult> {
  const data = await session.graphql<{ consumer: ConsumerGraph | null }>("consumer", CONSUMER_QUERY, {});
  return buildAuthResult(data.consumer ?? null);
}

export async function bootstrapAuthSessionWithDeps(deps: BootstrapAuthSessionDeps): Promise<AuthBootstrapResult> {
  await deps.clearBlockedBrowserImport().catch(() => {});

  const persistedAuth = await deps.checkPersistedAuth().catch(() => null);
  if (persistedAuth?.isLoggedIn) {
    return buildAuthBootstrapSuccess(persistedAuth, "Already signed in with saved local DoorDash session state. No browser interaction was needed.");
  }

  const imported = await deps.importBrowserSessionIfAvailable().catch(() => false);
  deps.markBrowserImportAttempted();
  if (imported) {
    const auth = await deps.checkAuthDirect();
    return auth.isLoggedIn
      ? buildAuthBootstrapSuccess(auth, "Imported an existing signed-in browser session and saved it for direct API use.")
      : buildAuthBootstrapFailure(auth, "Imported browser session state, but the consumer still appears to be logged out or guest-only.");
  }

  const attachedCandidates = await deps.getAttachedBrowserCdpCandidates();
  const reachableCandidates = await deps.getReachableCdpCandidates(attachedCandidates);

  if (reachableCandidates.length > 0) {
    const openedAttachedBrowser = await deps.openUrlInAttachedBrowser({
      cdpUrl: reachableCandidates[0]!,
      targetUrl: AUTH_BOOTSTRAP_URL,
    });
    const openedDefaultBrowser = openedAttachedBrowser ? false : await deps.openUrlInDefaultBrowser(AUTH_BOOTSTRAP_URL);

    deps.log(
      openedAttachedBrowser
        ? `Opened DoorDash in the attachable browser session I'm watching: ${AUTH_BOOTSTRAP_URL}`
        : openedDefaultBrowser
          ? `Found an attachable browser session, but couldn't drive it directly, so I opened DoorDash in your default browser: ${AUTH_BOOTSTRAP_URL}`
          : `Detected an attachable browser session, but couldn't open DoorDash automatically. Open this URL in that watched browser to continue: ${AUTH_BOOTSTRAP_URL}`,
    );
    deps.log(
      `Detected ${reachableCandidates.length} attachable browser session(s). Finish the sign-in in that browser window and I'll import it automatically for up to ${Math.round(AUTH_BOOTSTRAP_TIMEOUT_MS / 1000)} seconds.`,
    );

    const importedAfterWait = await deps.waitForAttachedBrowserSessionImport({
      timeoutMs: AUTH_BOOTSTRAP_TIMEOUT_MS,
      pollIntervalMs: AUTH_BOOTSTRAP_POLL_INTERVAL_MS,
    });

    const auth = await deps.checkAuthDirect();
    if (importedAfterWait) {
      return auth.isLoggedIn
        ? buildAuthBootstrapSuccess(auth, "Opened DoorDash in an attachable browser session, detected the signed-in consumer state, and saved it for direct API use.")
        : buildAuthBootstrapFailure(auth, "Detected browser session state in the watched browser, but the consumer still appears logged out or guest-only.");
    }

    return buildAuthBootstrapFailure(
      auth,
      openedAttachedBrowser || openedDefaultBrowser
        ? `Opened DoorDash and watched attachable browser sessions for ${Math.round(AUTH_BOOTSTRAP_TIMEOUT_MS / 1000)} seconds, but no signed-in DoorDash session was imported. Finish the login in that watched browser and rerun dd-cli login.`
        : `Watched attachable browser sessions for ${Math.round(AUTH_BOOTSTRAP_TIMEOUT_MS / 1000)} seconds without importing a signed-in DoorDash session. Open ${AUTH_BOOTSTRAP_URL} manually in the watched browser, finish signing in, then rerun dd-cli login.`,
    );
  }

  const desktopBrowserReuseGap = await deps.describeDesktopBrowserReuseGap().catch(() => null);
  if (desktopBrowserReuseGap) {
    deps.log(desktopBrowserReuseGap);
  }

  const manualManagedConfirmationAvailable = deps.canPromptForManagedBrowserConfirmation();
  deps.log(
    "I couldn't find an attachable browser session I can reuse, so I'm opening a temporary Chromium login window that the CLI can watch directly.",
  );
  deps.log(
    manualManagedConfirmationAvailable
      ? `Finish signing in in that window. I'll keep checking automatically for up to ${Math.round(AUTH_BOOTSTRAP_TIMEOUT_MS / 1000)} seconds. If the page already shows you're signed in and the CLI still hasn't finished, press Enter here to force an immediate recheck.`
      : `Finish signing in in that window. I'll keep checking automatically for up to ${Math.round(AUTH_BOOTSTRAP_TIMEOUT_MS / 1000)} seconds.`,
  );

  const managedAuth = await deps.waitForManagedBrowserLogin({
    targetUrl: AUTH_BOOTSTRAP_URL,
    timeoutMs: AUTH_BOOTSTRAP_TIMEOUT_MS,
    pollIntervalMs: AUTH_BOOTSTRAP_POLL_INTERVAL_MS,
    log: deps.log,
  });

  if (managedAuth.status === "completed") {
    return buildAuthBootstrapSuccess(
      managedAuth.auth,
      managedAuth.completion === "manual"
        ? "Opened a temporary Chromium login window. After you pressed Enter to confirm the browser login was complete, the CLI rechecked the signed-in session there and saved it for direct API use."
        : "Opened a temporary Chromium login window, detected the signed-in session there automatically, and saved it for direct API use.",
    );
  }

  if (managedAuth.status === "timed-out") {
    return buildAuthBootstrapFailure(
      managedAuth.auth,
      manualManagedConfirmationAvailable
        ? `Opened a temporary Chromium login window and watched for ${Math.round(AUTH_BOOTSTRAP_TIMEOUT_MS / 1000)} seconds, but I still couldn't prove an authenticated DoorDash session. If the browser already looks signed in, press Enter sooner next time to force an immediate recheck, or rerun dd-cli login.`
        : `Opened a temporary Chromium login window and watched for ${Math.round(AUTH_BOOTSTRAP_TIMEOUT_MS / 1000)} seconds, but no authenticated DoorDash session was established.`,
    );
  }

  const openedBrowser = await deps.openUrlInDefaultBrowser(AUTH_BOOTSTRAP_URL);
  deps.log(
    openedBrowser
      ? `I couldn't launch the temporary Chromium login window, so I opened DoorDash in your default browser instead: ${AUTH_BOOTSTRAP_URL}`
      : `Couldn't open the temporary Chromium login window or your default browser automatically. Open this URL to continue: ${AUTH_BOOTSTRAP_URL}`,
  );
  deps.log(
    "This environment still isn't exposing an attachable browser session the CLI can import, so I won't keep you waiting for the full login timeout. Once you've exposed an attachable browser session, rerun `dd-cli login`.",
  );

  const importedAfterGrace = await deps.waitForAttachedBrowserSessionImport({
    timeoutMs: AUTH_BOOTSTRAP_NO_DISCOVERY_GRACE_MS,
    pollIntervalMs: AUTH_BOOTSTRAP_POLL_INTERVAL_MS,
  });

  const auth = await deps.checkAuthDirect();
  if (importedAfterGrace) {
    return auth.isLoggedIn
      ? buildAuthBootstrapSuccess(auth, "An attachable browser session appeared a few seconds later and was saved for direct API use.")
      : buildAuthBootstrapFailure(auth, "Detected browser session state after opening the browser, but the consumer still appears logged out or guest-only.");
  }

  return buildAuthBootstrapFailure(
    auth,
    openedBrowser
      ? "Opened DoorDash in your default browser, but this environment still isn't exposing an attachable browser session the CLI can import. Finish signing in there, make an attachable browser session discoverable, then rerun `dd-cli login`."
      : "Couldn't open a watchable browser automatically, and this environment still isn't exposing an attachable browser session the CLI can import. Open the DoorDash home page manually, make an attachable browser session discoverable, then rerun `dd-cli login`.",
  );
}

export async function bootstrapAuthSession(): Promise<AuthBootstrapResult> {
  return bootstrapAuthSessionWithDeps({
    clearBlockedBrowserImport,
    checkPersistedAuth: inspectPersistedAuthDirect,
    importBrowserSessionIfAvailable,
    markBrowserImportAttempted: () => session.markBrowserImportAttempted(),
    getAttachedBrowserCdpCandidates: discoverAttachedBrowserCdpCandidates,
    getReachableCdpCandidates: probeReachableAttachedBrowserCdpCandidates,
    describeDesktopBrowserReuseGap,
    openUrlInAttachedBrowser,
    openUrlInDefaultBrowser,
    waitForAttachedBrowserSessionImport,
    waitForManagedBrowserLogin,
    canPromptForManagedBrowserConfirmation,
    checkAuthDirect,
    log: (message) => console.error(message),
  });
}

export async function clearStoredSession(): Promise<{ success: true; message: string; cookiesPath: string; storageStatePath: string }> {
  await session.close();
  session.resetBrowserImportAttempted();
  await rm(getCookiesPath(), { force: true }).catch(() => {});
  await rm(getStorageStatePath(), { force: true }).catch(() => {});
  await blockBrowserImport();
  return {
    success: true,
    message: "DoorDash cookies and stored browser session state cleared. Automatic browser-session reuse is disabled until the next `dd-cli login`.",
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

export async function getOrdersDirect(params: { limit?: number; activeOnly?: boolean } = {}): Promise<OrdersResult> {
  const requestedLimit = params.limit;
  const activeOnly = params.activeOnly ?? false;

  try {
    const orders = await fetchExistingOrdersGraphql({ limit: requestedLimit });
    return buildOrdersResult({
      source: "graphql",
      warning: null,
      orders,
      activeOnly,
      requestedLimit,
    });
  } catch (error) {
    if (!isOrderHistoryChallengeError(error)) {
      throw error;
    }

    const snapshot = await session.ordersPageSnapshot();
    const orders = extractExistingOrdersFromApolloCache(snapshot.cache);
    const warningParts = [
      "DoorDash challenged the direct order-history GraphQL request, so this response was recovered from the consumer-web orders page cache.",
      "This fallback is read-only and can be temporarily empty or limited to the first cached page.",
    ];

    if (snapshot.turnstileOverlayVisible) {
      warningParts.push("The orders page was still showing DoorDash's security check banner while this snapshot was captured.");
    }

    if (snapshot.noOrdersBanner) {
      warningParts.push("The live orders page rendered its 'No orders yet' state for this session.");
    }

    return buildOrdersResult({
      source: "orders-page-cache",
      warning: warningParts.join(" "),
      orders,
      activeOnly,
      requestedLimit,
    });
  }
}

export async function getOrderDirect(orderId: string): Promise<OrderResult> {
  const requestedOrderId = orderId.trim();
  if (!requestedOrderId) {
    throw new Error("Missing required order identifier.");
  }

  const orders = await getOrdersDirect();
  const match = findExistingOrderByIdentifier(orders.orders, requestedOrderId);
  if (!match) {
    throw new Error(`Could not find order ${requestedOrderId} in the available existing-order history.`);
  }

  return {
    success: true,
    source: orders.source,
    warning: orders.warning,
    matchedField: match.matchedField,
    order: match.order,
  };
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
  const currentCartStoreId = currentCart.restaurant?.id ?? null;
  const cartId = currentCartStoreId && currentCartStoreId !== params.restaurantId ? "" : (currentCart.cartId ?? "");
  const auth = await checkAuthDirect();

  const payload = await buildAddToCartPayload({
    restaurantId: params.restaurantId,
    cartId,
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

function isDoorDashUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "doordash.com" || url.hostname.endsWith(".doordash.com");
  } catch {
    return false;
  }
}

function hasDoorDashCookies(cookies: ReadonlyArray<Pick<Cookie, "domain">>): boolean {
  return cookies.some((cookie) => {
    const domain = cookie.domain.trim().replace(/^\./, "").toLowerCase();
    return domain === "doordash.com" || domain.endsWith(".doordash.com");
  });
}

export function selectAttachedBrowserImportMode(input: {
  pageUrls: readonly string[];
  cookies: ReadonlyArray<Pick<Cookie, "domain">>;
}): "page" | "cookies" | "skip" {
  if (input.pageUrls.some((url) => isDoorDashUrl(url))) {
    return "page";
  }

  if (hasDoorDashCookies(input.cookies)) {
    return "cookies";
  }

  return "skip";
}

export type BrowserSessionImportStrategy = "same-machine-chromium-profile" | "attached-browser-cdp";

export type SameMachineChromiumProfileTarget = {
  browserLabel: "Brave" | "Google Chrome";
  userDataDir: string;
  importMode: "linux-cookie-db" | "persistent-context";
  safeStorageApplication: string | null;
  executableCandidates: string[];
};

type SameMachineChromiumProfileResolutionInput = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

function trimEnvPathValue(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveWindowsLocalAppDataDir(input: SameMachineChromiumProfileResolutionInput): string {
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? homedir();
  return trimEnvPathValue(env.LOCALAPPDATA) ?? join(trimEnvPathValue(env.USERPROFILE) ?? homeDir, "AppData", "Local");
}

function resolveWindowsProgramFilesDirs(input: SameMachineChromiumProfileResolutionInput): string[] {
  const env = input.env ?? process.env;
  const candidates = [
    trimEnvPathValue(env.ProgramFiles),
    trimEnvPathValue(env["ProgramFiles(x86)"]),
  ].filter((value): value is string => Boolean(value));

  return dedupeBy(candidates, (value) => value.toLowerCase());
}

export function resolveSameMachineChromiumProfileTargets(
  input: SameMachineChromiumProfileResolutionInput = {},
): readonly SameMachineChromiumProfileTarget[] {
  const platform = input.platform ?? process.platform;
  const homeDir = input.homeDir ?? homedir();

  if (platform === "linux") {
    return LINUX_CHROMIUM_COOKIE_IMPORT_BROWSERS.map((browser) => ({
      browserLabel: browser.browserLabel,
      userDataDir: join(homeDir, ...browser.userDataDirSegments),
      importMode: "linux-cookie-db" as const,
      safeStorageApplication: browser.safeStorageApplication,
      executableCandidates: [],
    }));
  }

  if (platform === "darwin") {
    return [
      {
        browserLabel: "Brave",
        userDataDir: join(homeDir, "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
        importMode: "persistent-context",
        safeStorageApplication: null,
        executableCandidates: [
          "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
          join(homeDir, "Applications", "Brave Browser.app", "Contents", "MacOS", "Brave Browser"),
        ],
      },
      {
        browserLabel: "Google Chrome",
        userDataDir: join(homeDir, "Library", "Application Support", "Google", "Chrome"),
        importMode: "persistent-context",
        safeStorageApplication: null,
        executableCandidates: [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          join(homeDir, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
        ],
      },
    ] as const;
  }

  if (platform === "win32") {
    const localAppDataDir = resolveWindowsLocalAppDataDir(input);
    const programFilesDirs = resolveWindowsProgramFilesDirs(input);

    return [
      {
        browserLabel: "Brave",
        userDataDir: join(localAppDataDir, "BraveSoftware", "Brave-Browser", "User Data"),
        importMode: "persistent-context",
        safeStorageApplication: null,
        executableCandidates: dedupeBy(
          [
            join(localAppDataDir, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
            ...programFilesDirs.map((baseDir) => join(baseDir, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
          ],
          (value) => value.toLowerCase(),
        ),
      },
      {
        browserLabel: "Google Chrome",
        userDataDir: join(localAppDataDir, "Google", "Chrome", "User Data"),
        importMode: "persistent-context",
        safeStorageApplication: null,
        executableCandidates: dedupeBy(
          [
            join(localAppDataDir, "Google", "Chrome", "Application", "chrome.exe"),
            ...programFilesDirs.map((baseDir) => join(baseDir, "Google", "Chrome", "Application", "chrome.exe")),
          ],
          (value) => value.toLowerCase(),
        ),
      },
    ] as const;
  }

  return [];
}

export type LocalBrowserProfileImportCandidate = {
  browserLabel: string;
  userDataDir: string;
  userDataDirExists: boolean;
  importableProfileNames: string[];
  importableProfileCount: number;
};

export type LocalBrowserProfileImportInspection = {
  supported: boolean;
  platform: NodeJS.Platform;
  candidates: LocalBrowserProfileImportCandidate[];
};

export type AttachedBrowserCdpInspection = {
  discoveredCandidates: string[];
  reachableCandidates: string[];
  reuseGap: string | null;
};

export function preferredBrowserSessionImportStrategies(platform: NodeJS.Platform): readonly BrowserSessionImportStrategy[] {
  return ["linux", "darwin", "win32"].includes(platform)
    ? (["same-machine-chromium-profile", "attached-browser-cdp"] as const)
    : (["attached-browser-cdp"] as const);
}

export async function inspectLocalBrowserProfileImportCandidates(): Promise<LocalBrowserProfileImportInspection> {
  const targets = resolveSameMachineChromiumProfileTargets();
  if (targets.length === 0) {
    return {
      supported: false,
      platform: process.platform,
      candidates: [],
    };
  }

  const candidates = await Promise.all(
    targets.map(async (target) => {
      const userDataDirExists = await stat(target.userDataDir)
        .then((entry) => entry.isDirectory())
        .catch(() => false);

      let importableProfileNames: string[] = [];
      if (userDataDirExists) {
        importableProfileNames =
          target.importMode === "linux-cookie-db"
            ? (await readLinuxChromiumCookieImports({
                browserLabel: target.browserLabel,
                safeStorageApplication: target.safeStorageApplication ?? "",
                userDataDir: target.userDataDir,
              })).map((profileImport) => profileImport.profileName)
            : await readChromiumProfileNames(target.userDataDir, { includeDefaultFallback: false });
      }

      return {
        browserLabel: target.browserLabel,
        userDataDir: target.userDataDir,
        userDataDirExists,
        importableProfileNames,
        importableProfileCount: importableProfileNames.length,
      } satisfies LocalBrowserProfileImportCandidate;
    }),
  );

  return {
    supported: true,
    platform: process.platform,
    candidates,
  };
}

async function importBrowserSessionIfAvailable(): Promise<boolean> {
  for (const strategy of preferredBrowserSessionImportStrategies(process.platform)) {
    if (strategy === "same-machine-chromium-profile") {
      if (await importBrowserSessionFromSameMachineChromiumProfiles()) {
        return true;
      }
      continue;
    }

    if (await importBrowserSessionFromCdpCandidates(await discoverAttachedBrowserCdpCandidates())) {
      return true;
    }
  }

  return false;
}

async function importBrowserSessionFromSameMachineChromiumProfiles(): Promise<boolean> {
  const originalArtifacts = await snapshotStoredSessionArtifacts();

  for (const target of resolveSameMachineChromiumProfileTargets()) {
    const imported =
      target.importMode === "linux-cookie-db"
        ? await importBrowserSessionFromLinuxChromiumProfiles(target)
        : await importBrowserSessionFromPersistentChromiumProfile(target);
    if (imported) {
      return true;
    }

    await restoreStoredSessionArtifacts(originalArtifacts);
  }

  return false;
}

async function importBrowserSessionFromLinuxChromiumProfiles(target: SameMachineChromiumProfileTarget): Promise<boolean> {
  if (process.platform !== "linux" || target.importMode !== "linux-cookie-db" || !target.safeStorageApplication) {
    return false;
  }

  const profileImports = await readLinuxChromiumCookieImports({
    browserLabel: target.browserLabel,
    safeStorageApplication: target.safeStorageApplication,
    userDataDir: target.userDataDir,
  });
  for (const profileImport of profileImports) {
    if (!hasDoorDashCookies(profileImport.cookies)) {
      continue;
    }

    await writeStoredSessionArtifacts(profileImport.cookies);
    const persistedAuth = await inspectPersistedAuthDirect();
    if (persistedAuth?.isLoggedIn) {
      return true;
    }
  }

  return false;
}

async function importBrowserSessionFromPersistentChromiumProfile(target: SameMachineChromiumProfileTarget): Promise<boolean> {
  if (target.importMode !== "persistent-context") {
    return false;
  }

  if (!(await pathExists(target.userDataDir))) {
    return false;
  }

  const executablePath = await findFirstExistingPath(target.executableCandidates);
  if (!executablePath) {
    return false;
  }

  const profileNames = await readChromiumProfileNames(target.userDataDir);
  for (const profileName of profileNames) {
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      context = await chromium.launchPersistentContext(target.userDataDir, {
        headless: true,
        executablePath,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          `--profile-directory=${profileName}`,
        ],
        userAgent: DEFAULT_USER_AGENT,
        locale: "en-US",
        viewport: { width: 1280, height: 900 },
      });

      page = context.pages()[0] ?? (await context.newPage());
      await page.goto(`${BASE_URL}/home`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
      await page.waitForTimeout(1_000).catch(() => {});

      const consumerData = await fetchConsumerViaPage(page).catch(() => null);
      const consumer = consumerData?.consumer ?? null;
      if (!consumer || consumer.isGuest !== false) {
        continue;
      }

      const cookies = await context.cookies();
      if (!hasDoorDashCookies(cookies)) {
        continue;
      }

      await saveContextState(context, cookies);
      if (await validatePersistedDirectSessionArtifacts()) {
        return true;
      }
    } catch {
      continue;
    } finally {
      await page?.close().catch(() => {});
      await context?.close().catch(() => {});
    }
  }

  return false;
}

async function importBrowserSessionFromCdpCandidates(candidates: string[]): Promise<boolean> {
  for (const cdpUrl of candidates) {
    if (!(await isCdpEndpointReachable(cdpUrl))) {
      continue;
    }

    let browser: Browser | null = null;
    let tempPage: Page | null = null;
    try {
      browser = await chromium.connectOverCDP(cdpUrl, { timeout: ATTACHED_BROWSER_CDP_CONNECT_TIMEOUT_MS });
      const context = browser.contexts()[0];
      if (!context) {
        continue;
      }

      const cookies = await context.cookies();
      const pages = context.pages();
      const importMode = selectAttachedBrowserImportMode({
        pageUrls: pages.map((candidate) => candidate.url()),
        cookies,
      });
      if (importMode === "skip") {
        continue;
      }

      if (importMode === "cookies") {
        await saveContextState(context, cookies);
        if (await validatePersistedDirectSessionArtifacts()) {
          return true;
        }
      }

      let page = pages.find((candidate) => isDoorDashUrl(candidate.url())) ?? null;
      if (!page) {
        tempPage = await context.newPage();
        page = tempPage;
        await page.goto(`${BASE_URL}/home`, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
        await page.waitForTimeout(1_000);
      }

      const consumerData = await fetchConsumerViaPage(page).catch(() => null);
      const consumer = consumerData?.consumer ?? null;
      if (!consumer || consumer.isGuest !== false) {
        continue;
      }

      await saveContextState(context, cookies);
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

  return parseGraphQlResponse<{ consumer: ConsumerGraph | null }>("attachedBrowserConsumerImport", raw.status, raw.text);
}

async function readLiveManagedBrowserAuth(page: Page | null): Promise<AuthResult> {
  if (!page || page.isClosed()) {
    return buildAuthResult(null);
  }

  const consumerData = await fetchConsumerViaPage(page).catch(() => null);
  return buildAuthResult(consumerData?.consumer ?? null);
}

async function confirmManagedBrowserAuth(context: BrowserContext | null, page: Page | null): Promise<AuthResult> {
  const liveAuth = await readLiveManagedBrowserAuth(page);
  if (liveAuth.isLoggedIn) {
    if (context) {
      await saveContextState(context).catch(() => {});
    }
    return liveAuth;
  }

  if (context) {
    await saveContextState(context).catch(() => {});
  }

  return (await inspectPersistedAuthDirect().catch(() => null)) ?? liveAuth;
}

async function saveContextState(context: BrowserContext, cookies: Cookie[] | null = null): Promise<void> {
  const storageStatePath = getStorageStatePath();
  await ensureConfigDir();
  await context.storageState({ path: storageStatePath });

  const resolvedCookies = cookies ?? (await context.cookies());
  await writeFile(getCookiesPath(), JSON.stringify(resolvedCookies, null, 2));
}

export async function inspectPersistedAuthDirect(): Promise<AuthResult | null> {
  if (!(await hasPersistedSessionArtifacts())) {
    return null;
  }

  await session.close().catch(() => {});
  session.markBrowserImportAttempted();

  try {
    return await checkAuthDirect();
  } catch {
    return null;
  } finally {
    await session.close().catch(() => {});
  }
}

async function validatePersistedDirectSessionArtifacts(): Promise<boolean> {
  const auth = await inspectPersistedAuthDirect();
  return auth?.isLoggedIn === true;
}

export function resolveAttachedBrowserCdpCandidates(
  env: NodeJS.ProcessEnv,
  configCandidates: string[] = [],
): string[] {
  const candidates = new Set<string>();
  const addCandidate = (value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) {
      candidates.add(normalizeCdpCandidate(value));
    }
  };

  addCdpCandidatesFromList(candidates, env.DOORDASH_ATTACHED_BROWSER_CDP_URLS);
  addCdpCandidatesFromList(candidates, env.DOORDASH_BROWSER_CDP_URLS);
  addCandidate(env.DOORDASH_ATTACHED_BROWSER_CDP_URL);
  addCandidate(env.DOORDASH_BROWSER_CDP_URL);
  addCdpPortCandidatesFromList(candidates, env.DOORDASH_BROWSER_CDP_PORTS);
  const portCandidate = parseCdpPortCandidate(env.DOORDASH_BROWSER_CDP_PORT);
  if (portCandidate) {
    candidates.add(portCandidate);
  }

  for (const compatibilityValue of [env.DOORDASH_MANAGED_BROWSER_CDP_URL, env.OPENCLAW_BROWSER_CDP_URL, env.OPENCLAW_OPENCLAW_CDP_URL]) {
    addCandidate(compatibilityValue);
  }

  for (const value of configCandidates) {
    addCandidate(value);
  }

  addCandidate("http://127.0.0.1:18792");
  addCandidate("http://127.0.0.1:18800");
  addCandidate("http://127.0.0.1:9222");
  return [...candidates];
}

export async function discoverAttachedBrowserCdpCandidates(): Promise<string[]> {
  const configCandidates = await readOpenClawBrowserConfigCandidates({ profileNames: ["user", "chrome", "openclaw"] });
  return resolveAttachedBrowserCdpCandidates(process.env, configCandidates);
}

export async function probeReachableAttachedBrowserCdpCandidates(candidates: string[]): Promise<string[]> {
  const reachable: string[] = [];
  for (const cdpUrl of candidates) {
    if (await isCdpEndpointReachable(cdpUrl)) {
      reachable.push(cdpUrl);
    }
  }
  return reachable;
}

async function waitForAttachedBrowserSessionImport(input: { timeoutMs: number; pollIntervalMs: number }): Promise<boolean> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() <= deadline) {
    if (await importBrowserSessionIfAvailable().catch(() => false)) {
      return true;
    }

    if (Date.now() >= deadline) {
      break;
    }

    await wait(input.pollIntervalMs);
  }

  return false;
}

export function resolveSystemBrowserOpenCommand(
  targetUrl: string,
  targetPlatform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  if (targetPlatform === "darwin") {
    return { command: "open", args: [targetUrl] };
  }

  if (targetPlatform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", targetUrl] };
  }

  if (["linux", "freebsd", "openbsd", "netbsd", "sunos", "android"].includes(targetPlatform)) {
    return { command: "xdg-open", args: [targetUrl] };
  }

  return null;
}

async function openUrlInDefaultBrowser(targetUrl: string): Promise<boolean> {
  const command = resolveSystemBrowserOpenCommand(targetUrl);
  if (!command) {
    return false;
  }

  return await new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });

    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

async function openUrlInAttachedBrowser(input: { cdpUrl: string; targetUrl: string }): Promise<boolean> {
  let browser: Browser | null = null;

  try {
    browser = await chromium.connectOverCDP(input.cdpUrl, { timeout: ATTACHED_BROWSER_CDP_CONNECT_TIMEOUT_MS });
    const context = browser.contexts()[0];
    if (!context) {
      return false;
    }

    let page = context.pages().find((candidate) => isDoorDashUrl(candidate.url())) ?? null;
    if (!page) {
      page = await context.newPage();
    }

    await page.goto(input.targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
    await page.bringToFront().catch(() => {});
    return true;
  } catch {
    return false;
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function waitForManagedBrowserLogin(input: {
  targetUrl: string;
  timeoutMs: number;
  pollIntervalMs: number;
  log: (message: string) => void;
}): Promise<ManagedBrowserLoginResult> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const manualConfirmation = createManagedBrowserManualConfirmationHandle();

  try {
    browser = await chromium.launch({
      headless: false,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"],
    });

    const storageStatePath = getStorageStatePath();
    const hasStorage = await hasStorageState();
    context = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      locale: "en-US",
      viewport: { width: 1280, height: 900 },
      ...(hasStorage ? { storageState: storageStatePath } : {}),
    });

    if (!hasStorage) {
      const cookies = await readStoredCookies();
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
    }

    page = await context.newPage();
    await page.goto(input.targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
    await page.bringToFront().catch(() => {});

    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() <= deadline) {
      const liveAuth = await readLiveManagedBrowserAuth(page);
      if (liveAuth.isLoggedIn) {
        await saveContextState(context).catch(() => {});
        return {
          status: "completed",
          completion: "automatic",
          auth: liveAuth,
        };
      }

      if (manualConfirmation.consumeRequested()) {
        const confirmedAuth = await confirmManagedBrowserAuth(context, page);
        if (confirmedAuth.isLoggedIn) {
          return {
            status: "completed",
            completion: "manual",
            auth: confirmedAuth,
          };
        }

        input.log(
          "Still not seeing an authenticated DoorDash session yet. Finish signing in in the opened browser window, then press Enter again or keep waiting for automatic detection.",
        );
      }

      if (page.isClosed()) {
        break;
      }

      if (Date.now() >= deadline) {
        break;
      }

      await wait(input.pollIntervalMs);
    }

    const finalAuth = await confirmManagedBrowserAuth(context, page);
    if (finalAuth.isLoggedIn) {
      return {
        status: "completed",
        completion: "automatic",
        auth: finalAuth,
      };
    }

    return {
      status: "timed-out",
      auth: finalAuth,
    };
  } catch (error) {
    if (isPlaywrightBrowserInstallMissingError(error)) {
      return { status: "launch-failed" };
    }

    return { status: "launch-failed" };
  } finally {
    manualConfirmation.close();
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

function isPlaywrightBrowserInstallMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("executable doesn't exist") || message.includes("please run the following command") || message.includes("playwright install");
}

type KnownDesktopBrowser = {
  label: string;
  processMatchers: readonly RegExp[];
  devToolsActivePortPaths: readonly string[];
};

const KNOWN_DESKTOP_BROWSERS: readonly KnownDesktopBrowser[] = [
  {
    label: "Brave",
    processMatchers: [/\bbrave-browser(?:-stable)?\b/i, /\/brave(?:$|\s)/i],
    devToolsActivePortPaths: [
      join(homedir(), ".config", "BraveSoftware", "Brave-Browser", "DevToolsActivePort"),
      join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser", "DevToolsActivePort"),
    ],
  },
  {
    label: "Google Chrome",
    processMatchers: [/\bgoogle-chrome(?:-stable|-beta|-unstable)?\b/i, /\/google-chrome(?:$|\s)/i],
    devToolsActivePortPaths: [
      join(homedir(), ".config", "google-chrome", "DevToolsActivePort"),
      join(homedir(), "Library", "Application Support", "Google", "Chrome", "DevToolsActivePort"),
    ],
  },
  {
    label: "Microsoft Edge",
    processMatchers: [/\bmicrosoft-edge(?:-stable|-beta|-dev)?\b/i, /\/microsoft-edge(?:$|\s)/i],
    devToolsActivePortPaths: [
      join(homedir(), ".config", "microsoft-edge", "DevToolsActivePort"),
      join(homedir(), "Library", "Application Support", "Microsoft Edge", "DevToolsActivePort"),
    ],
  },
  {
    label: "Chromium",
    processMatchers: [/\bchromium-browser\b/i, /\bchromium\b/i],
    devToolsActivePortPaths: [
      join(homedir(), ".config", "chromium", "DevToolsActivePort"),
      join(homedir(), "Library", "Application Support", "Chromium", "DevToolsActivePort"),
    ],
  },
] as const;

function normalizeCdpCandidate(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function addCdpCandidatesFromList(candidates: Set<string>, value: string | undefined): void {
  if (!value) {
    return;
  }

  for (const entry of value.split(/[,\n]/)) {
    const trimmed = entry.trim();
    if (trimmed) {
      candidates.add(normalizeCdpCandidate(trimmed));
    }
  }
}

function addCdpPortCandidatesFromList(candidates: Set<string>, value: string | undefined): void {
  if (!value) {
    return;
  }

  for (const entry of value.split(/[,\n]/)) {
    const portCandidate = parseCdpPortCandidate(entry.trim());
    if (portCandidate) {
      candidates.add(portCandidate);
    }
  }
}

function parseCdpPortCandidate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return `http://127.0.0.1:${parsed}`;
}

function appendBrowserConfigCandidate(candidates: string[], value: unknown): void {
  const object = asObject(value);
  if (typeof object.cdpUrl === "string" && object.cdpUrl.trim()) {
    candidates.push(normalizeCdpCandidate(object.cdpUrl));
  } else if (typeof object.cdpPort === "number" && Number.isInteger(object.cdpPort)) {
    candidates.push(`http://127.0.0.1:${object.cdpPort}`);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function detectRunningDesktopBrowser(processCommands: readonly string[]): KnownDesktopBrowser | null {
  const filteredCommands = processCommands
    .map((command) => command.trim())
    .filter((command) => command.length > 0)
    .filter((command) => !/chrome-devtools-mcp/i.test(command));

  for (const browser of KNOWN_DESKTOP_BROWSERS) {
    const preferredMatch = filteredCommands.some(
      (command) => !/--type=|crashpad|zygote/i.test(command) && browser.processMatchers.some((matcher) => matcher.test(command)),
    );
    if (preferredMatch) {
      return browser;
    }
  }

  for (const browser of KNOWN_DESKTOP_BROWSERS) {
    if (filteredCommands.some((command) => browser.processMatchers.some((matcher) => matcher.test(command)))) {
      return browser;
    }
  }

  return null;
}

function hasRemoteDebuggingSignal(processCommands: readonly string[]): boolean {
  return processCommands.some((command) => /--remote-debugging-(?:port|pipe)(?:=|\b)/i.test(command));
}

export function summarizeDesktopBrowserReuseGap(input: {
  processCommands: readonly string[];
  hasAnyDevToolsActivePort: boolean;
}): string | null {
  const browser = detectRunningDesktopBrowser(input.processCommands);
  if (!browser) {
    return null;
  }

  if (hasRemoteDebuggingSignal(input.processCommands) || input.hasAnyDevToolsActivePort) {
    return null;
  }

  return `I can see ${browser.label} is already running on this desktop, but dd-cli still couldn't reuse it automatically. It is not exposing an attachable browser automation session right now, and no importable signed-in DoorDash browser profile state was found.`;
}

async function captureCommandStdout(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; stdin?: string } = {},
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.once("error", reject);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stdin?.end(options.stdin ?? "");
    child.once("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }

      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`${command} exited with code ${code ?? "null"}${stderrText ? `: ${stderrText}` : ""}`));
    });
  });
}

async function listProcessCommands(targetPlatform: NodeJS.Platform = process.platform): Promise<string[]> {
  if (targetPlatform === "win32") {
    return [];
  }

  const args = targetPlatform === "darwin" ? ["-axo", "command="] : ["-eo", "command="];
  const stdout = await captureCommandStdout("ps", args).catch(() => "");
  return stdout
    .split(/\r?\n/)
    .map((command) => command.trim())
    .filter((command) => command.length > 0);
}

async function hasAnyKnownDevToolsActivePort(): Promise<boolean> {
  for (const browser of KNOWN_DESKTOP_BROWSERS) {
    for (const path of browser.devToolsActivePortPaths) {
      if ((await readFile(path, "utf8").catch(() => null)) !== null) {
        return true;
      }
    }
  }

  return false;
}

async function describeDesktopBrowserReuseGap(): Promise<string | null> {
  const processCommands = await listProcessCommands();
  return summarizeDesktopBrowserReuseGap({
    processCommands,
    hasAnyDevToolsActivePort: await hasAnyKnownDevToolsActivePort(),
  });
}

export async function inspectAttachedBrowserCdpCandidates(): Promise<AttachedBrowserCdpInspection> {
  const discoveredCandidates = await discoverAttachedBrowserCdpCandidates();
  const reachableCandidates = await probeReachableAttachedBrowserCdpCandidates(discoveredCandidates);
  return {
    discoveredCandidates,
    reachableCandidates,
    reuseGap: await describeDesktopBrowserReuseGap(),
  };
}

async function readOpenClawBrowserConfigCandidates(input: { profileNames: string[] }): Promise<string[]> {
  try {
    const raw = await readFile(join(homedir(), ".openclaw", "openclaw.json"), "utf8");
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    const browserConfig = asObject(parsed?.browser);
    const profiles = asObject(browserConfig.profiles);
    const candidates: string[] = [];

    appendBrowserConfigCandidate(candidates, browserConfig);
    appendBrowserConfigCandidate(candidates, browserConfig.openclaw);

    for (const profileName of input.profileNames) {
      appendBrowserConfigCandidate(candidates, profiles[profileName]);
    }

    return dedupeBy(candidates, (value) => value);
  } catch {
    return [];
  }
}

async function isCdpEndpointReachable(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`, {
      signal: AbortSignal.timeout(ATTACHED_BROWSER_CDP_REACHABILITY_TIMEOUT_MS),
    });
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

export function parseMenuResponse(storepageFeed: unknown, requestedRestaurantId: string): MenuResult {
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

export function parseItemResponse(itemPage: unknown, restaurantId: string): ItemResult {
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

export function parseCartResponse(cartRoot: unknown | null): CartResult {
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


export function parseExistingOrderLifecycleStatus(orderRoot: unknown): ExistingOrderLifecycleStatus {
  const order = asObject(orderRoot);

  if (typeof order.cancelledAt === "string" && order.cancelledAt.length > 0) {
    return "cancelled";
  }

  if (typeof order.fulfilledAt === "string" && order.fulfilledAt.length > 0) {
    return "fulfilled";
  }

  if (typeof order.pollingInterval === "number" && order.pollingInterval > 0) {
    return "in-progress";
  }

  if (typeof order.submittedAt === "string" && order.submittedAt.length > 0) {
    return "submitted";
  }

  if (typeof order.createdAt === "string" && order.createdAt.length > 0) {
    return "draft";
  }

  return "unknown";
}

export function parseExistingOrdersResponse(orderRoots: unknown[]): ExistingOrderResult[] {
  return orderRoots
    .map((order) => parseExistingOrder(order))
    .sort((left, right) => compareIsoDateDesc(left.createdAt, right.createdAt));
}

export function extractExistingOrdersFromApolloCache(cache: Record<string, unknown> | null): ExistingOrderResult[] {
  if (!cache) {
    return [];
  }

  const rootQuery = asObject(cache.ROOT_QUERY);
  const key = Object.keys(rootQuery)
    .filter((entry) => entry.startsWith("getConsumerOrdersWithDetails("))
    .sort()[0];

  if (!key) {
    return [];
  }

  const values = Array.isArray(rootQuery[key]) ? rootQuery[key] : [];
  return values.map((value) => parseExistingOrder(value, cache)).sort((left, right) => compareIsoDateDesc(left.createdAt, right.createdAt));
}

function parseExistingOrder(orderRoot: unknown, cache: Record<string, unknown> | null = null): ExistingOrderResult {
  const order = asObject(resolveApolloCacheValue(cache, orderRoot));
  const creator = order.creator ? asObject(resolveApolloCacheValue(cache, order.creator)) : null;
  const deliveryAddress = order.deliveryAddress ? asObject(resolveApolloCacheValue(cache, order.deliveryAddress)) : null;
  const store = order.store ? asObject(resolveApolloCacheValue(cache, order.store)) : null;
  const lifecycleStatus = parseExistingOrderLifecycleStatus(order);
  const items = parseExistingOrderItems(order.orders, cache);

  return {
    id: typeof order.id === "string" ? order.id : null,
    orderUuid: typeof order.orderUuid === "string" ? order.orderUuid : null,
    deliveryUuid: typeof order.deliveryUuid === "string" ? order.deliveryUuid : null,
    createdAt: typeof order.createdAt === "string" ? order.createdAt : null,
    submittedAt: typeof order.submittedAt === "string" ? order.submittedAt : null,
    cancelledAt: typeof order.cancelledAt === "string" ? order.cancelledAt : null,
    fulfilledAt: typeof order.fulfilledAt === "string" ? order.fulfilledAt : null,
    lifecycleStatus,
    isActive: lifecycleStatus === "submitted" || lifecycleStatus === "in-progress",
    hasLiveTracking: typeof order.pollingInterval === "number" && order.pollingInterval > 0,
    pollingIntervalSeconds: typeof order.pollingInterval === "number" ? order.pollingInterval : null,
    specialInstructions: typeof order.specialInstructions === "string" ? order.specialInstructions : null,
    isReorderable: Boolean(order.isReorderable),
    isGift: Boolean(order.isGift),
    isPickup: Boolean(order.isPickup),
    isRetail: Boolean(order.isRetail),
    isMerchantShipping: Boolean(order.isMerchantShipping),
    containsAlcohol: Boolean(order.containsAlcohol),
    fulfillmentType: typeof order.fulfillmentType === "string" ? order.fulfillmentType : null,
    shoppingProtocol: typeof order.shoppingProtocol === "string" ? order.shoppingProtocol : null,
    orderFilterType: typeof order.orderFilterType === "string" ? order.orderFilterType : null,
    creator: creator
      ? {
          id: typeof creator.id === "string" ? creator.id : null,
          firstName: typeof creator.firstName === "string" ? creator.firstName : null,
          lastName: typeof creator.lastName === "string" ? creator.lastName : null,
        }
      : null,
    deliveryAddress: deliveryAddress
      ? {
          id: typeof deliveryAddress.id === "string" ? deliveryAddress.id : null,
          formattedAddress: typeof deliveryAddress.formattedAddress === "string" ? deliveryAddress.formattedAddress : null,
        }
      : null,
    store: store
      ? {
          id: typeof store.id === "string" ? store.id : null,
          name: typeof store.name === "string" ? store.name : null,
          businessName: typeof asObject(resolveApolloCacheValue(cache, store.business)).name === "string"
            ? asObject(resolveApolloCacheValue(cache, store.business)).name
            : null,
          phoneNumber: typeof store.phoneNumber === "string" ? store.phoneNumber : null,
          fulfillsOwnDeliveries: typeof store.fulfillsOwnDeliveries === "boolean" ? store.fulfillsOwnDeliveries : null,
          customerArrivedPickupInstructions:
            typeof store.customerArrivedPickupInstructions === "string" ? store.customerArrivedPickupInstructions : null,
          rerouteStoreId: typeof store.rerouteStoreId === "string" ? store.rerouteStoreId : null,
        }
      : null,
    grandTotal: parseExistingOrderMoney(order.grandTotal, cache),
    itemCount: items.length,
    items,
    likelyOutOfStockItems: Array.isArray(order.likelyOosItems)
      ? order.likelyOosItems.map((item) => {
          const object = asObject(resolveApolloCacheValue(cache, item));
          return {
            menuItemId: typeof object.menuItemId === "string" ? object.menuItemId : null,
            name: typeof object.name === "string" ? object.name : null,
            photoUrl: typeof object.photoUrl === "string" ? object.photoUrl : null,
          };
        })
      : [],
    recurringOrderDetails: order.recurringOrderDetails
      ? {
          itemNames: Array.isArray(asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).itemNames)
            ? asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).itemNames.filter((value: unknown): value is string => typeof value === "string")
            : [],
          consumerId:
            typeof asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).consumerId === "string"
              ? asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).consumerId
              : null,
          recurringOrderUpcomingOrderUuid:
            typeof asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).recurringOrderUpcomingOrderUuid === "string"
              ? asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).recurringOrderUpcomingOrderUuid
              : null,
          scheduledDeliveryDate:
            typeof asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).scheduledDeliveryDate === "string"
              ? asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).scheduledDeliveryDate
              : null,
          arrivalTimeDisplayString:
            typeof asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).arrivalTimeDisplayString === "string"
              ? asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).arrivalTimeDisplayString
              : null,
          storeName:
            typeof asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).storeName === "string"
              ? asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).storeName
              : null,
          isCancelled:
            typeof asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).isCancelled === "boolean"
              ? asObject(resolveApolloCacheValue(cache, order.recurringOrderDetails)).isCancelled
              : null,
        }
      : null,
    bundleOrderInfo: order.bundleOrderInfo
      ? {
          primaryBundleOrderUuid:
            typeof asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).primaryBundleOrderUuid === "string"
              ? asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).primaryBundleOrderUuid
              : null,
          primaryBundleOrderId:
            typeof asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).primaryBundleOrderId === "string"
              ? asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).primaryBundleOrderId
              : null,
          bundleOrderUuids: Array.isArray(asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).bundleOrderUuids)
            ? asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).bundleOrderUuids.filter((value: unknown): value is string => typeof value === "string")
            : [],
          bundleType:
            typeof asObject(resolveApolloCacheValue(cache, asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).bundleOrderConfig)).bundleType === "string"
              ? asObject(resolveApolloCacheValue(cache, asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).bundleOrderConfig)).bundleType
              : null,
          bundleOrderRole:
            typeof asObject(resolveApolloCacheValue(cache, asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).bundleOrderConfig)).bundleOrderRole === "string"
              ? asObject(resolveApolloCacheValue(cache, asObject(resolveApolloCacheValue(cache, order.bundleOrderInfo)).bundleOrderConfig)).bundleOrderRole
              : null,
        }
      : null,
    cancellationPendingRefundState:
      typeof asObject(resolveApolloCacheValue(cache, order.cancellationPendingRefundInfo)).state === "string"
        ? asObject(resolveApolloCacheValue(cache, order.cancellationPendingRefundInfo)).state
        : null,
  };
}

function parseExistingOrderMoney(value: unknown, cache: Record<string, unknown> | null): ExistingOrderMoneyResult | null {
  if (!value) {
    return null;
  }

  const object = asObject(resolveApolloCacheValue(cache, value));
  return {
    unitAmount: typeof object.unitAmount === "number" ? object.unitAmount : null,
    currency: typeof object.currency === "string" ? object.currency : null,
    decimalPlaces: typeof object.decimalPlaces === "number" ? object.decimalPlaces : null,
    displayString: typeof object.displayString === "string" ? object.displayString : null,
    sign: typeof object.sign === "string" ? object.sign : null,
  };
}

function parseExistingOrderItems(value: unknown, cache: Record<string, unknown> | null): ExistingOrderItemResult[] {
  const groups = Array.isArray(value) ? value : [];
  return groups.flatMap((group) => {
    const object = asObject(resolveApolloCacheValue(cache, group));
    const items = Array.isArray(object.items) ? object.items : [];
    return items.map((item) => parseExistingOrderItem(item, cache));
  });
}

function parseExistingOrderItem(value: unknown, cache: Record<string, unknown> | null): ExistingOrderItemResult {
  const object = asObject(resolveApolloCacheValue(cache, value));
  return {
    id: typeof object.id === "string" ? object.id : null,
    name: typeof object.name === "string" ? object.name : null,
    quantity: typeof object.quantity === "number" ? object.quantity : 0,
    specialInstructions: typeof object.specialInstructions === "string" ? object.specialInstructions : null,
    substitutionPreferences: typeof object.substitutionPreferences === "string" ? object.substitutionPreferences : null,
    originalItemPrice: typeof object.originalItemPrice === "number" ? object.originalItemPrice : null,
    purchaseType: typeof object.purchaseType === "string" ? object.purchaseType : null,
    purchaseQuantity: parseExistingOrderQuantity(object.purchaseQuantity, cache),
    fulfillQuantity: parseExistingOrderQuantity(object.fulfillQuantity, cache),
    extras: Array.isArray(object.orderItemExtras)
      ? object.orderItemExtras.map((extra) => parseExistingOrderExtra(extra, cache))
      : [],
  };
}

function parseExistingOrderQuantity(value: unknown, cache: Record<string, unknown> | null): ExistingOrderQuantityResult | null {
  if (!value) {
    return null;
  }

  const quantityRoot = asObject(resolveApolloCacheValue(cache, value));
  const continuous = asObject(resolveApolloCacheValue(cache, quantityRoot.continuousQuantity));
  const discrete = asObject(resolveApolloCacheValue(cache, quantityRoot.discreteQuantity));
  const candidate = typeof continuous.quantity === "number" ? continuous : discrete;

  return {
    quantity: typeof candidate.quantity === "number" ? candidate.quantity : null,
    unit: typeof candidate.unit === "string" ? candidate.unit : null,
  };
}

function parseExistingOrderExtra(value: unknown, cache: Record<string, unknown> | null): ExistingOrderExtraResult {
  const object = asObject(resolveApolloCacheValue(cache, value));
  return {
    menuItemExtraId: typeof object.menuItemExtraId === "string" ? object.menuItemExtraId : null,
    name: typeof object.name === "string" ? object.name : null,
    options: Array.isArray(object.orderItemExtraOptions)
      ? object.orderItemExtraOptions.map((option) => parseExistingOrderExtraOption(option, cache))
      : [],
  };
}

function parseExistingOrderExtraOption(value: unknown, cache: Record<string, unknown> | null): ExistingOrderExtraOptionResult {
  const object = asObject(resolveApolloCacheValue(cache, value));
  return {
    menuExtraOptionId: typeof object.menuExtraOptionId === "string" ? object.menuExtraOptionId : null,
    name: typeof object.name === "string" ? object.name : null,
    description: typeof object.description === "string" ? object.description : null,
    price: typeof object.price === "number" ? object.price : null,
    quantity: typeof object.quantity === "number" ? object.quantity : null,
    extras: Array.isArray(object.orderItemExtras)
      ? object.orderItemExtras.map((extra) => parseExistingOrderExtra(extra, cache))
      : [],
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

async function fetchExistingOrdersGraphql(params: { limit?: number }): Promise<ExistingOrderResult[]> {
  const requestedLimit = params.limit;
  const orders: ExistingOrderResult[] = [];
  let offset = 0;

  while (true) {
    const pageSize = requestedLimit == null ? 25 : Math.min(25, Math.max(requestedLimit - orders.length, 0));
    if (requestedLimit != null && pageSize === 0) {
      break;
    }

    const data = await session.graphql<{ getConsumerOrdersWithDetails?: unknown[] }>(
      "getConsumerOrdersWithDetails",
      EXISTING_ORDERS_QUERY,
      {
        offset,
        limit: pageSize === 0 ? 25 : pageSize,
        includeCancelled: true,
      },
    );

    const batch = parseExistingOrdersResponse(Array.isArray(data.getConsumerOrdersWithDetails) ? data.getConsumerOrdersWithDetails : []);
    if (batch.length === 0) {
      break;
    }

    orders.push(...batch);
    offset += batch.length;

    if (batch.length < (pageSize === 0 ? 25 : pageSize)) {
      break;
    }
  }

  return requestedLimit == null ? orders : orders.slice(0, requestedLimit);
}

function buildOrdersResult(input: {
  source: "graphql" | "orders-page-cache";
  warning: string | null;
  orders: ExistingOrderResult[];
  activeOnly: boolean;
  requestedLimit?: number;
}): OrdersResult {
  const filtered = input.activeOnly ? input.orders.filter((order) => order.isActive) : input.orders;
  const limited = input.requestedLimit == null ? filtered : filtered.slice(0, input.requestedLimit);
  return {
    success: true,
    source: input.source,
    warning: input.warning,
    count: limited.length,
    activeCount: limited.filter((order) => order.isActive).length,
    orders: limited,
  };
}

function findExistingOrderByIdentifier(
  orders: ExistingOrderResult[],
  orderId: string,
): { matchedField: "id" | "orderUuid" | "deliveryUuid"; order: ExistingOrderResult } | null {
  for (const field of ["orderUuid", "deliveryUuid", "id"] as const) {
    const match = orders.find((order) => order[field] === orderId);
    if (match) {
      return { matchedField: field, order: match };
    }
  }

  return null;
}

function resolveApolloCacheValue(cache: Record<string, unknown> | null, value: unknown): unknown {
  if (!cache) {
    return value;
  }

  if (typeof value === "string" && value in cache) {
    return cache[value];
  }

  const object = asObject(value);
  if (typeof object.__ref === "string" && object.__ref in cache) {
    return cache[object.__ref];
  }

  return value;
}

function compareIsoDateDesc(left: string | null, right: string | null): number {
  const leftValue = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightValue = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}

function isOrderHistoryChallengeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /non-JSON response|Checking if the site connection is secured|cf-mitigated|DoorDash getConsumerOrdersWithDetails returned HTTP 403/i.test(
    error.message,
  );
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

type StoredSessionArtifactsSnapshot = {
  cookiesRaw: string | null;
  storageStateRaw: string | null;
};

type LinuxChromiumCookieImport = {
  browserLabel: string;
  profileName: string;
  cookies: Cookie[];
};

async function ensureConfigDir(): Promise<void> {
  await mkdir(dirname(getCookiesPath()), { recursive: true });
}

async function snapshotStoredSessionArtifacts(): Promise<StoredSessionArtifactsSnapshot> {
  const [cookiesRaw, storageStateRaw] = await Promise.all([
    readFile(getCookiesPath(), "utf8").catch(() => null),
    readFile(getStorageStatePath(), "utf8").catch(() => null),
  ]);

  return { cookiesRaw, storageStateRaw };
}

async function restoreStoredSessionArtifacts(snapshot: StoredSessionArtifactsSnapshot): Promise<void> {
  await ensureConfigDir();

  if (snapshot.cookiesRaw === null) {
    await rm(getCookiesPath(), { force: true }).catch(() => {});
  } else {
    await writeFile(getCookiesPath(), snapshot.cookiesRaw);
  }

  if (snapshot.storageStateRaw === null) {
    await rm(getStorageStatePath(), { force: true }).catch(() => {});
  } else {
    await writeFile(getStorageStatePath(), snapshot.storageStateRaw);
  }
}

async function writeStoredSessionArtifacts(cookies: Cookie[]): Promise<void> {
  await ensureConfigDir();
  await writeFile(getCookiesPath(), JSON.stringify(cookies, null, 2));
  await writeFile(
    getStorageStatePath(),
    JSON.stringify({ cookies, origins: [] satisfies [] }, null, 2),
  );
}

async function readLinuxChromiumCookieImports(input: {
  browserLabel: string;
  safeStorageApplication: string;
  userDataDir: string;
}): Promise<LinuxChromiumCookieImport[]> {
  try {
    const stdout = await captureCommandStdout("python3", ["-c", LINUX_CHROMIUM_COOKIE_IMPORT_SCRIPT], {
      env: {
        ...process.env,
        DD_BROWSER_LABEL: input.browserLabel,
        DD_BROWSER_SAFE_STORAGE_APP: input.safeStorageApplication,
        DD_BROWSER_USER_DATA_DIR: input.userDataDir,
      },
    });
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      const object = asObject(entry);
      const browserLabel = typeof object.browserLabel === "string" ? object.browserLabel.trim() : "";
      const profileName = typeof object.profileName === "string" ? object.profileName.trim() : "";
      if (!browserLabel || !profileName || !Array.isArray(object.cookies)) {
        return [];
      }

      const cookies = object.cookies.flatMap((cookie): Cookie[] => {
        const parsedCookie = asObject(cookie);
        const name = typeof parsedCookie.name === "string" ? parsedCookie.name : "";
        const value = typeof parsedCookie.value === "string" ? parsedCookie.value : "";
        const domain = typeof parsedCookie.domain === "string" ? parsedCookie.domain : "";
        const path = typeof parsedCookie.path === "string" && parsedCookie.path ? parsedCookie.path : "/";
        const sameSiteRaw = typeof parsedCookie.sameSite === "string" ? parsedCookie.sameSite : "Lax";
        const sameSite: Cookie["sameSite"] =
          sameSiteRaw === "Strict" || sameSiteRaw === "None" || sameSiteRaw === "Lax" ? sameSiteRaw : "Lax";
        const expires = typeof parsedCookie.expires === "number" && Number.isFinite(parsedCookie.expires) ? parsedCookie.expires : -1;
        if (!name || !domain) {
          return [];
        }
        return [
          {
            name,
            value,
            domain,
            path,
            expires,
            httpOnly: Boolean(parsedCookie.httpOnly),
            secure: Boolean(parsedCookie.secure),
            sameSite,
          },
        ];
      });

      if (cookies.length === 0) {
        return [];
      }

      return [{ browserLabel, profileName, cookies }];
    });
  } catch {
    return [];
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findFirstExistingPath(paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    if (await pathExists(path)) {
      return path;
    }
  }

  return null;
}

async function readChromiumProfileNames(
  userDataDir: string,
  options: { includeDefaultFallback?: boolean } = {},
): Promise<string[]> {
  const localStateRaw = await readFile(join(userDataDir, "Local State"), "utf8").catch(() => null);
  const infoCache = asObject(
    asObject(safeJsonParse<Record<string, unknown>>(localStateRaw ?? undefined)?.profile).info_cache,
  );
  const sortedFromLocalState = Object.entries(infoCache)
    .flatMap(([profileName, info]) => {
      if (!profileName.trim()) {
        return [];
      }

      const infoObject = asObject(info);
      const activeTime = typeof infoObject.active_time === "number" ? infoObject.active_time : Number(infoObject.active_time ?? 0);
      return [
        {
          profileName,
          activeTime: Number.isFinite(activeTime) ? activeTime : 0,
        },
      ];
    })
    .sort((left, right) => {
      if (left.profileName === "Default" && right.profileName !== "Default") {
        return -1;
      }
      if (right.profileName === "Default" && left.profileName !== "Default") {
        return 1;
      }
      return right.activeTime - left.activeTime;
    })
    .map((entry) => entry.profileName);

  const directoryNames = (await readdir(userDataDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === "Default" || /^Profile\s+\d+$/i.test(name));

  const profileNames = options.includeDefaultFallback === false
    ? [...sortedFromLocalState, ...directoryNames]
    : ["Default", ...sortedFromLocalState, ...directoryNames];

  return dedupeBy(profileNames, (value) => value);
}

async function hasBlockedBrowserImport(): Promise<boolean> {
  try {
    await readFile(getBrowserImportBlockPath(), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function blockBrowserImport(): Promise<void> {
  await ensureConfigDir();
  await writeFile(getBrowserImportBlockPath(), "logged-out\n");
}

async function clearBlockedBrowserImport(): Promise<void> {
  await rm(getBrowserImportBlockPath(), { force: true }).catch(() => {});
}

async function hasStorageState(): Promise<boolean> {
  try {
    await readFile(getStorageStatePath(), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function hasPersistedSessionArtifacts(): Promise<boolean> {
  if (await hasStorageState()) {
    return true;
  }

  return (await readStoredCookies()).length > 0;
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

