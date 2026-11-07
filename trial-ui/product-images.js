// Fixed variants keep browser/CDN cache keys stable. Only existing public product
// images are transformed; signed/private URLs must keep their original token/options.
const storageOrigin = 'https://taceqfnsorewelsbdckg.supabase.co';
const sizes = { list: 128, grid: 320 };
const failedThumbnails = new Map();
export function noteThumbnailFailure(source) {
  try {
    const url = new URL(source);
    if (url.origin !== storageOrigin || !url.pathname.startsWith('/storage/v1/render/image/public/product-images/') || url.searchParams.has('token')) return;
    failedThumbnails.set(url.href, Date.now() + 60000);
    if (failedThumbnails.size > 128) failedThumbnails.delete(failedThumbnails.keys().next().value);
  } catch { /* Not a public product thumbnail. */ }
}
const pending = new WeakMap();
const errorHandlers = new WeakMap();
let gridObserver;
function loadNearViewport(image, source) {
  if (typeof IntersectionObserver === 'undefined') { image.src = source; return; }
  gridObserver ||= new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) if (isIntersecting && pending.has(target)) {
      const source = pending.get(target); pending.delete(target); gridObserver.unobserve(target); target.src = source;
    }
  }, { rootMargin: '200px' });
  pending.set(image, source); gridObserver.observe(image);
}
// A redraw may discard off-screen tiles. Do not retain those nodes in the observer.
export function suspendProductThumbnail(image) { gridObserver?.unobserve(image); }
export function productThumbnailUrl(source, variant = 'list') {
  const original = String(source || '');
  try {
    const url = new URL(original), size = sizes[variant];
    if (!size || url.origin !== storageOrigin || url.username || url.password
      || !url.pathname.startsWith('/storage/v1/object/public/product-images/')
      || !/\.(png|jpe?g|webp)$/i.test(url.pathname)
      || url.searchParams.has('token') || url.searchParams.has('download')) return original;
    url.pathname = url.pathname.replace('/object/public/', '/render/image/public/');
    for (const [key, value] of Object.entries({ width: size, height: size, resize: 'contain', quality: 75 })) url.searchParams.set(key, String(value));
    const until = failedThumbnails.get(url.href);
    if (until > Date.now()) return original;
    if (until) failedThumbnails.delete(url.href);
    return url.href;
  } catch { return original; }
}

/** Configure a list/grid image before attaching it. Original source is never mutated. */
export function setProductThumbnail(image, source, variant = 'list', onError) {
  if (image.dataset.productImageSource === source && image.dataset.productImageVariant === variant) {
    if (pending.has(image)) gridObserver?.observe(image);
    return image;
  }
  suspendProductThumbnail(image); pending.delete(image);
  if (errorHandlers.has(image)) image.removeEventListener('error', errorHandlers.get(image));
  const thumbnail = productThumbnailUrl(source, variant);
  image.loading = 'lazy'; image.decoding = 'async';
  image.width = variant === 'grid' ? 160 : 64; image.height = image.width;
  image.dataset.productImageSource = source;
  image.dataset.productImageVariant = variant;
  let fallback = thumbnail !== source;
  const failed = () => {
    if (fallback) { fallback = false; noteThumbnailFailure(thumbnail); image.src = source; }
    else { image.removeEventListener('error', failed); errorHandlers.delete(image); onError?.(); }
  };
  image.addEventListener('error', failed);
  errorHandlers.set(image, failed);
  if (variant === 'grid' && thumbnail !== source) loadNearViewport(image, thumbnail);
  else image.src = thumbnail;
  return image;
}
