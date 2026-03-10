# DoorDash consumer web API research

_Date:_ 2026-03-10  
_Status:_ historical reverse-engineering report. The repo has **since** shipped the direct GraphQL/HTTP transport as the default path for the cart-safe CLI surface; treat the implementation status below as a time-stamped research snapshot unless a later note overrides it.

## Status update for the current repo

Since this report was written, the CLI now uses the direct consumer-web transport by default for `auth-check`, `set-address`, `search`, `menu`, `item`, `cart`, `add-to-cart`, and `update-cart`.

Current known limits still match the safety posture from this research:

- `set-address` still fails closed when DoorDash does not expose a saved `defaultAddressId`
- nested cursor-driven option trees are still rejected instead of guessed
- checkout, payment, order placement, and tracking remain intentionally out of scope

## Executive summary

At the time of this research, a direct consumer-web API path looked **viable** for the cart-safe workflow, and materially better than DOM-driven Playwright for most of the CLI surface.

DoorDash’s consumer web app is not scraping hidden HTML; it is making first-party JSON requests against a mix of:

- `https://www.doordash.com/graphql/<operation>?operation=<operation>`
- `https://www.doordash.com/unified-gateway/geo-intelligence/v2/address/autocomplete`

The good news:

- **Auth/session check**: directly supported via GraphQL.
- **Restaurant search**: directly supported via GraphQL autocomplete/search feed.
- **Menu/item fetch**: directly supported via GraphQL (`storepageFeed`, `itemPage`).
- **Cart read**: directly supported via GraphQL (`consumerOrderCart`, `listCarts`, `detailedCartItems`, `getOpenCartsCount`).
- **Cart add/update**: directly supported via GraphQL mutations (`addCartItemV2`, `updateCartItemV2`).

The remaining blocker is not cart mutation. The blocker is **reliable address-context bootstrap/persistence** and a **clean, standalone extraction of the full store menu query document** for `storepageFeed` without relying on runtime bundle state.

Because of that, I do **not** recommend a hard pivot of the CLI to direct API calls today without one more validation pass. I do recommend building an **experimental direct transport** next, then promoting it once address persistence and logged-in validation are confirmed.

## High-confidence findings

## 1) Request pattern and auth model

The consumer web app uses normal browser cookies plus GraphQL JSON bodies.

Common request characteristics:

- Method: `POST` for GraphQL, `GET` for address autocomplete
- GraphQL URL shape:
  - `/graphql/consumer?operation=consumer`
  - `/graphql/autocompleteFacetFeed?operation=autocompleteFacetFeed`
  - `/graphql/itemPage?operation=itemPage`
  - `/graphql/addCartItem?operation=addCartItem`
  - `/graphql/updateCartItem?operation=updateCartItem`
- Common headers:
  - `accept: */*`
  - `content-type: application/json`
  - `accept-language: en-US`
  - `x-experience-id: doordash`
  - `x-channel-id: marketplace`
  - `apollographql-client-name: @doordash/app-consumer-production-ssr-client`
  - `apollographql-client-version: 3.0`
  - `x-csrftoken: ""` (observed blank in guest flow)
  - browser cookies

Observed cookie names used by the web app during successful guest/cart requests:

- `dd_device_id`
- `dd_device_session_id`
- `dd_session_id`
- `dd_delivery_correlation_id`
- `dd_market_id`
- `ddweb_session_id`
- Cloudflare/session cookies (`cf_clearance`, `__cf_bm`, `_cfuvid`, etc.)

Notable storage state on the web app side:

- `localStorage.submarket_id`
- `localStorage.zipcode`
- `localStorage.consumerId`
- `localStorage.isGuest`

### Interpretation

This is a classic cookie-backed first-party web API. It does **not** look like the current CLI needs Playwright for cart logic itself; it mainly needs browser help for:

- session bootstrap / cookie acquisition
- possibly address persistence bootstrap
- possibly Cloudflare/session establishment on a fresh machine

## 2) Auth/session check

### Endpoint

`POST /graphql/consumer?operation=consumer`

### Purpose

Returns consumer/session state, including whether the current browser session is a guest, default address, addresses, and current order cart.

### Observed guest response characteristics

- `consumer.id: null`
- `consumer.userId: null`
- `consumer.isGuest: true`
- `consumer.defaultAddress`: populated after address selection
- `consumer.orderCart`: `null` before add-to-cart, populated afterward

### Why this matters

This is the clean direct replacement for the current browser-based `auth-check` implementation.

For a logged-in personal account, the exact same endpoint is the most likely direct session/auth probe; we have not yet validated it on a live authenticated account.

## 3) Address context

### Address autocomplete endpoint

`GET /unified-gateway/geo-intelligence/v2/address/autocomplete?input_address=<urlencoded>`

### Observed request metadata

The browser sent additional context such as:

- `x-unified-gateway-generated-source: v1`
- `dd-ids: {"dd_device_id":"...","dd_session_id":"..."}`
- `X-Experience-Id: doordash`

### Observed response shape

For `350 5th Ave, New York, NY 10118`, the response returned a prediction with:

- `lat`
- `lng`
- `formatted_address`
- `formatted_address_short`
- `postal_code`
- `administrative_area_level1`
- `locality`
- `street_address`
- `source_place_id`

### Related address queries observed

- `POST /graphql/getAvailableAddresses?operation=getAvailableAddresses`
- `POST /graphql/dropoffOptions?operation=dropoffOptions`
- Apollo standby query observed: `getAddressByPoint`

### What is still missing

I did **not** isolate the exact write/persist call that turns an autocomplete selection into the active delivery context in a fresh standalone HTTP client.

The UI clearly winds up with:

- a populated `consumer.defaultAddress`
- `localStorage.zipcode`
- `localStorage.submarket_id`
- `dd_market_id` cookie

### 2026-03-10 addendum: resolved mutation path

After searching the live consumer-web bundle, the exact new-address save mutation was identified in production JS:

- mutation name: `addConsumerAddressV2`
- required core variables: `lat`, `lng`, `city`, `state`, `zipCode`, `printableAddress`, `shortname`, `googlePlaceId`
- optional nullable variables used by the UI form: `subpremise`, `driverInstructions`, `dropoffOptionId`, `manualLat`, `manualLng`, `addressLinkType`, `buildingName`, `entryCode`, `personalAddressLabel`, `addressId`

The browser save flow is therefore:

1. autocomplete (`/unified-gateway/geo-intelligence/v2/address/autocomplete`)
2. geo get-or-create (`/unified-gateway/geo-intelligence/v2/address/get-or-create`)
3. GraphQL `addConsumerAddressV2(...)`

The direct CLI can safely enroll a brand-new freeform address by building the exact `addConsumerAddressV2` variable payload from the autocomplete + get-or-create result and letting DoorDash persist it.

### Practical conclusion

Direct **address lookup** is confirmed. Direct **address persistence / active delivery context set** is now **safely implemented** via `addConsumerAddressV2` for new addresses and `updateConsumerDefaultAddressV2` for already-saved addresses.

## 4) Restaurant search

### Endpoint

`POST /graphql/autocompleteFacetFeed?operation=autocompleteFacetFeed`

### Observed variables

```json
{
  "query": "sushi"
}
```

### Result quality

This returned both:

- suggested query rows
- store suggestions including store IDs

Example result traits observed:

- store title/name
- subtitles like hours/status
- description/cuisine text
- image URLs
- rating metadata in custom/logging fields
- click navigation URIs like `store/1721744/?pickup=false`

### Practical conclusion

For the CLI’s `search` command, this looks like a good direct replacement candidate even before solving the full search-results page feed.

## 5) Menu / store fetch

### Store page feed

Observed Apollo query name:

- `storepageFeed`

Observed variables on a live store page:

```json
{
  "storeId": "1721744",
  "menuId": "2181443",
  "isMerchantPreview": false,
  "fulfillmentType": "Delivery",
  "cursor": null,
  "scheduledTime": null,
  "entryPoint": "External"
}
```

### What it appears to return

The query schema clearly covers:

- store header/meta
- banners
- menu categories
- menu content/feed sections
- footer and store metadata

### Important blocker

I captured the operation name, variable shape, and large portions of the request document, but I did **not** yet extract a clean minimal standalone query document for `storepageFeed`.

The runtime bundle holds a deduplicated version, while naive extraction from Apollo runtime objects produced duplicated fragment definitions and GraphQL validation failures.

### Item page

### Endpoint

`POST /graphql/itemPage?operation=itemPage`

### Observed variables

Example captured variables for a real menu item:

```json
{
  "itemId": "546936015",
  "consumerId": null,
  "storeId": "1721744",
  "isMerchantPreview": false,
  "isNested": false,
  "shouldFetchPresetCarousels": true,
  "fulfillmentType": "Delivery",
  "cursorContext": {
    "itemCursor": "<opaque cursor>"
  },
  "shouldFetchStoreLiteData": false
}
```

### Observed response contents

The response returned:

- item header/name/description
- price and currency
- menu ID
- review summary
- required option lists
- selectable options and IDs
- optional upsells

### Practical conclusion

`itemPage` is enough to support a robust **item details / option resolution** flow once the CLI has either:

- a store feed that enumerates item IDs, or
- a previously discovered item ID from another source

## 6) Cart read

### Endpoints observed

- `POST /graphql/consumerOrderCart?operation=consumerOrderCart`
- `POST /graphql/listCarts?operation=listCarts`
- `POST /graphql/detailedCartItems?operation=detailedCartItems`
- `POST /graphql/getOpenCartsCount?operation=getOpenCartsCount`

### Behavior observed

Before add-to-cart:

- `consumerOrderCart` returned `null`
- `listCarts` returned `[]`

After add-to-cart:

- `consumerOrderCart` returned the active cart
- `listCarts` returned the active store cart
- `getOpenCartsCount` returned `1`
- `detailedCartItems` returned expanded line-item/item/category/pricing data

### Practical conclusion

The read path for cart state is in very good shape for a direct client.

## 7) Cart add

### Endpoint

`POST /graphql/addCartItem?operation=addCartItem`

### Actual mutation name inside the body

`addCartItemV2`

### Captured input shape

```json
{
  "addCartItemInput": {
    "storeId": "1721744",
    "menuId": "2181443",
    "itemId": "546936015",
    "itemName": "Two roll selection",
    "itemDescription": "Spicy tuna, salmon avo, eel cuc, yellowtail scallion, California Roll.",
    "currency": "USD",
    "quantity": 1,
    "nestedOptions": "[...]",
    "specialInstructions": "",
    "substitutionPreference": "substitute",
    "unitPrice": 1898,
    "cartId": "",
    "isBundle": false,
    "bundleType": "BUNDLE_TYPE_UNSPECIFIED"
  },
  "lowPriorityBatchAddCartItemInput": [],
  "fulfillmentContext": {
    "shouldUpdateFulfillment": false,
    "fulfillmentType": "Delivery"
  },
  "monitoringContext": {
    "isGroup": false
  },
  "cartContext": {
    "isBundle": false
  },
  "returnCartFromOrderService": false,
  "shouldKeepOnlyOneActiveCart": false
}
```

### Observed result

A guest cart was successfully created and returned a real `cartId`, line items, restaurant info, and pricing.

### 2026-03-10 addendum: nested standalone recommended items

The production bundle's cart builder (`chunks/8427-*.js`) shows two parallel payload channels:

- `addCartItemInput.nestedOptions` for ordinary modifier trees
- `lowPriorityBatchAddCartItemInput` for selected child items whose parent is flagged `isStandaloneItem`

A live direct mutation confirmed the transport for standalone recommended add-ons that open a cursor-driven subconfiguration step:

- parent item remains in `addCartItemInput`
- the standalone add-on is emitted as its own `lowPriorityBatchAddCartItemInput[]` entry
- the child add-on's own required selections become that low-priority item's `nestedOptions`

For the observed Sushi 35 example, the main item stayed `Two roll selection`, while `Sake (salmon)` was added as a separate low-priority cart item with nested option `sashimi`.

### Practical conclusion

Direct add-to-cart is confirmed viable in a guest/session-backed context, including validated standalone recommended nested cursor add-ons through `lowPriorityBatchAddCartItemInput`.

## 8) Cart update

### Endpoint

`POST /graphql/updateCartItem?operation=updateCartItem`

### Actual mutation name inside the body

`updateCartItemV2`

### Captured input shape

```json
{
  "updateCartItemApiParams": {
    "cartId": "<cart-id>",
    "cartItemId": "<cart-item-id>",
    "itemId": "546936015",
    "quantity": 2,
    "storeId": "1721744",
    "purchaseTypeOptions": {
      "purchaseType": "PURCHASE_TYPE_UNSPECIFIED",
      "continuousQuantity": 0,
      "unit": null
    },
    "cartFilter": null
  },
  "fulfillmentContext": {
    "shouldUpdateFulfillment": false
  },
  "returnCartFromOrderService": false
}
```

### Observed result

The quantity increased successfully and the cart subtotal updated from `1898` to `3796`.

### Practical conclusion

Direct cart quantity updates are confirmed viable.

## 9) Guest consumer creation behavior

A noteworthy detail from the live capture:

- Before cart creation, `consumer.id` was `null`.
- After `addCartItemV2`, the cart response included a creator/consumer ID.
- The browser then stored `localStorage.consumerId`.

This strongly suggests that DoorDash can lazily materialize a guest consumer/cart identity during cart mutation, which is good news for a direct client.

## What I did **not** do

Per safety constraints, I did **not**:

- checkout
- place an order
- open payment flows intentionally
- track an order
- use browser-driven ordering as the main solution

The only live interactions were cart-safe:

- address autocomplete
- search autocomplete
- store/item inspection
- add to cart
- update cart quantity
- cart inspection

## Viability assessment by command

### `auth-check`
**Viable now** via `consumer`

### `set-address`
**Partially viable**

- address lookup: yes
- address persistence / active delivery context write: not yet fully isolated

### `search`
**Viable now** via `autocompleteFacetFeed`

### `menu`
**Mostly viable, but incomplete**

- `itemPage`: confirmed
- `storepageFeed`: confirmed operation/vars, but standalone minimal query extraction still needed

### `add-to-cart`
**Viable now** via `addCartItemV2`

### `cart`
**Viable now** via `consumerOrderCart` / `listCarts` / `detailedCartItems`

### quantity update
**Viable now** via `updateCartItemV2`

## Why I did not ship the transport yet

I did not wire the CLI over to direct HTTP calls in this checkpoint because doing so safely still needs two things:

1. **Address bootstrap solved cleanly**
   - The CLI cannot be considered a full replacement until it can establish delivery context reliably.

2. **Menu feed query extraction cleaned up**
   - `storepageFeed` is clearly the right endpoint, but the standalone query document still needs to be extracted cleanly from the shipped bundle/runtime without fragment duplication issues.

If I shipped now, the result would be an awkward hybrid with a brittle direct menu bootstrap and unclear address-setting semantics.

## Best next move

Build a new **experimental direct transport** behind a feature flag, in this order:

1. `consumer`-based `auth-check`
2. `autocompleteFacetFeed`-based `search`
3. `consumerOrderCart` / `listCarts` / `detailedCartItems` cart reads
4. `addCartItemV2`
5. `updateCartItemV2`
6. `storepageFeed` once the minimal query document is extracted cleanly
7. keep `set-address` browser-assisted until the address persistence write is isolated

That would let the CLI move the dangerous/brittle parts out of DOM automation first, while leaving only address bootstrap in the browser path temporarily.

## Minimal manual step if logged-in validation is required

If we need to validate this against a **real logged-in personal DoorDash session** rather than a guest session, the minimal safe step is:

1. Open a normal Chrome tab at `https://www.doordash.com/` and sign in.
2. Open a store page or your cart page.
3. Click the browser relay extension button on that tab so the badge shows **ON**.
4. Do **one** cart-safe action only: refresh the tab, or open the cart panel.

That is enough to capture the logged-in `consumer` / `listCarts` / cart headers and verify whether the same direct API path works for a personal account, without touching checkout or payment.

## Recommended implementation direction for the repo

### Short-term

- Keep the current browser wrapper as the stable path.
- Add a new internal `direct-api` transport module.
- Start with read/cart mutation operations that are already confirmed.

### Medium-term

- Promote direct transport to default for:
  - auth-check
  - search
  - cart
  - add/update cart
- Leave address bootstrap as an explicit browser-assisted step until fully solved.

### Long-term

- Remove most Playwright dependencies from the default workflow.
- Retain browser tooling only for:
  - initial login/cookie bootstrap
  - fallback recovery
  - address-context bootstrap if DoorDash keeps that state machine browser-specific
