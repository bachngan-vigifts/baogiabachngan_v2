// Include the offline review's financial/filter regression suite in the regular CI test discovery.
// Dynamic URL avoids implying that the review-only JavaScript is an application TypeScript module.
await import(new URL('../../scripts/testing/supplier-workspace-model.test.mjs', import.meta.url).href);
export {};
