import {productThumbnailUrl,setProductThumbnail,suspendProductThumbnail} from '../product-images.js';
import {imageSource} from './render.js';

// Defer src until after insertion: public Storage images must not start a full
// download before the thumbnail helper can observe their position in the grid.
export function catalogueThumbnailTag(product,cls,esc,variant='grid') {
 const size=variant==='grid'?160:64;
 return `<img class="${esc(cls)}" data-catalogue-image="${esc(product.image)}" data-catalogue-variant="${variant}" alt="${esc(product.name)}" loading="lazy" decoding="async" width="${size}" height="${size}">`;
}
export function hydrateCatalogueThumbnails(root) {
 for(const image of root.querySelectorAll('img[data-catalogue-image]')) {
  const source=image.dataset.catalogueImage,variant=image.dataset.catalogueVariant;
  // Keep the existing proxy/data/signed URL behavior for other sources. Only
  // supported public product images bypass that full-size proxy for transforms.
  const display=productThumbnailUrl(source,variant)===source?imageSource(source):source;
  setProductThumbnail(image,display,variant);
 }
}
export function releaseCatalogueThumbnails(root) {
 for(const image of root?.querySelectorAll('img[data-catalogue-image]')||[])suspendProductThumbnail(image);
}
