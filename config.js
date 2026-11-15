// Icon Genius — Appwrite wiring (Phase 0 setup, Nov 14 2026).
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
    // uploads/exports will live under key prefixes in this bucket in later phases.
    generatedIcons: "6af94beb0034b27954f2",
    uploads: "",
    exports: ""
  }
};
