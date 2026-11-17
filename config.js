// Icon Genius — Appwrite wiring (Phase 0 setup, Nov 14 2026) + Phase 2 config (Nov 17 2026).
window.IG_CONFIG = {
  endpoint: "https://sfo.cloud.appwrite.io/v1",
  projectId: "68fb8de1001dec33a5e2",
  databaseId: "6af947d50001ed59018b",
  collections: {
    users: "6af948200025e3eaaa00",
    collections: "6af948ee000196e2b02e",
    generations: "6af949b600196bc1528c",
    kits: "6af94a9c000e5fd744c7",
    exports: "6af94b430034be756c23"
  },
  buckets: {
    // Appwrite Free plan allows ONE bucket. generated-icons is it;
    // uploads/exports live under key prefixes in this bucket.
    generatedIcons: "6af94beb0034b27954f2",
    uploads: "",
    exports: ""
  },

  /* Phase 2 — generation is 100% client-side (Queston, Nov 17 2026:
     "Bypass api... Or make our own"). The engine in engine.js composes and
     restyles icons in the browser. No API key, no external service. */
  generation: {
    engine: "client",
    freeSetMax: 6,          // composed icons per set without credits
    creditSetMax: 24,       // composed icons per set when spending credits
    creditPerIcon: 1        // 1 credit = commercial license for 1 generated icon
  },

  /* Credits. Stripe product creation was refused by the Stripe connector
     (HTTP 403, Nov 16 + Nov 17 2026), so the live rail is PayPal
     (paypal.me/queston — Queston's authorized fallback, Nov 17 2026).
     Fulfillment is automatic (Queston, Nov 17: "Automate this"): buyers
     file a claim in-app with their account email in the PayPal note; an
     hourly watcher matches the PayPal payment email to the claim (exact
     amount + email in note) and grants the credits in Appwrite, marking
     the claim granted with the payment email's message id as evidence.
     Unmatched/ambiguous claims stay queued — never guess-granted.
     Watcher: goals/icon-genius/hidden_files/paypal-grant-watcher/.
     If Stripe writes ever open up, create the three products/prices,
     put their price IDs in stripePriceIds, and flip rail to "stripe"
     (fulfillment then runs off the Stripe webhook instead). */
  credits: {
    rail: "paypal",
    packs: [
      { id: "starter",  name: "Starter",  price: 3,  credits: 25,
        paypalUrl: "https://paypal.me/queston/3",  stripePriceId: "" },
      { id: "explorer", name: "Explorer", price: 5,  credits: 50,
        paypalUrl: "https://paypal.me/queston/5",  stripePriceId: "" },
      { id: "advanced", name: "Advanced", price: 14, credits: 150,
        paypalUrl: "https://paypal.me/queston/14", stripePriceId: "" }
    ]
  }
};
