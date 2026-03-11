# doordash-cli examples

Use the preferred lowercase command name `doordash-cli`. `dd-cli` is an equivalent shorter alias.

If you are running from a local checkout without linking, prefix commands with:

```bash
npm run cli --
```

For installation and first-run setup, see [install.md](install.md).

All commands print JSON.

## Session setup

Install the matching Chromium build once if you do not already have it:

```bash
doordash-cli install-browser
```

Check whether you already have reusable session state:

```bash
doordash-cli auth-check
```

If needed, launch Chromium for a one-time sign-in and save reusable state:

```bash
doordash-cli login
```

Reset saved session state when you want a clean start:

```bash
doordash-cli logout
```

## Search, menus, and items

Set the active delivery address before discovery commands:

```bash
doordash-cli set-address --address "350 5th Ave, New York, NY 10118"
```

Search by query, with or without a cuisine filter:

```bash
doordash-cli search --query tacos
doordash-cli search --query tacos --cuisine mexican
```

Inspect a restaurant menu and a specific item:

```bash
doordash-cli menu --restaurant-id 1721744
doordash-cli item --restaurant-id 1721744 --item-id 546936015
```

## Existing orders

List recent existing orders:

```bash
doordash-cli orders
doordash-cli orders --limit 5
```

Focus on still-active orders only:

```bash
doordash-cli orders --active-only
```

Inspect one order in detail. `--order-id` accepts the CLI's returned internal ID, `orderUuid`, or `deliveryUuid`:

```bash
doordash-cli order --order-id 3f4c6d0e-1234-5678-90ab-cdef12345678
```

## Cart basics

Add by item ID:

```bash
doordash-cli add-to-cart --restaurant-id 1721744 --item-id 876658890 --quantity 2
```

Add by visible item name:

```bash
doordash-cli add-to-cart --restaurant-id 1721744 --item-name "Spicy Tuna Roll"
```

Add with special instructions:

```bash
doordash-cli add-to-cart \
  --restaurant-id 1721744 \
  --item-name "Fries" \
  --special-instructions "extra crispy"
```

Update quantity or remove an item:

```bash
doordash-cli update-cart --cart-item-id 3b231d03-5a72-4636-8d12-c8769d706d45 --quantity 1
doordash-cli update-cart --cart-item-id 3b231d03-5a72-4636-8d12-c8769d706d45 --quantity 0
```

Inspect the active cart before or after a mutation:

```bash
doordash-cli cart
```

## Configurable items

For items with required option groups, pass `--options-json` with explicit selections:

```bash
doordash-cli add-to-cart \
  --restaurant-id 1721744 \
  --item-id 546936015 \
  --options-json '[
    {"groupId":"703393388","optionId":"4716032529"},
    {"groupId":"703393389","optionId":"4716042466"}
  ]'
```

Supported standalone recommended add-ons can include recursive `children` selections:

```bash
doordash-cli add-to-cart \
  --restaurant-id 1721744 \
  --item-id 546936015 \
  --options-json '[
    {"groupId":"703393388","optionId":"4716032529"},
    {"groupId":"703393389","optionId":"4716042466"},
    {
      "groupId":"recommended_option_546935995",
      "optionId":"546936011",
      "children":[
        {"groupId":"780057412","optionId":"4702669757"}
      ]
    }
  ]'
```

Guardrails:

- unknown group IDs or option IDs are rejected
- required min/max selection counts are enforced
- duplicate nested selections are rejected
- unsupported nested transport shapes fail closed
