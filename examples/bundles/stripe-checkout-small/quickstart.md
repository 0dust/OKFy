---
type: "API Reference"
title: "Checkout quickstart"
description: "Create a server endpoint that creates a Checkout Session, then redirect the customer to the session URL. See Checkout Sessions API and Checkout webhooks. Original source: https://d"
resource: "quickstart.html"
tags:
  - "quickstart"
  - "checkout"
timestamp: "2026-06-14T00:00:00.000Z"
---
# Checkout quickstart

Create a server endpoint that creates a Checkout Session, then redirect the customer to the session URL.

```
const session = await stripe.checkout.sessions.create({
  mode: "payment",
  line_items: [{ price: "price_123", quantity: 1 }],
  success_url: "https://example.com/success",
  cancel_url: "https://example.com/cancel"
});
```

See [Checkout Sessions API](./sessions.md) and [Checkout webhooks](./webhooks.md).

Original source: [https://docs.stripe.com/checkout/quickstart](https://docs.stripe.com/checkout/quickstart)
