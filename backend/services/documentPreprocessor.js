const sharp = require('sharp');

async function preprocessBase(buffer) {
  return sharp(buffer)
    .rotate()
    .grayscale()
    .normalize()
    .sharpen()
    .resize({ width: 2200, withoutEnlargement: false })
    .png()
    .toBuffer();
}

async function preprocessThreshold(buffer, threshold = 170) {
  return sharp(buffer)
    .rotate()
    .grayscale()
    .normalize()
    .sharpen()
    .threshold(threshold)
    .resize({ width: 2200, withoutEnlargement: false })
    .png()
    .toBuffer();
}

async function buildVariants(buffer, options = {}) {
  const fastMode = Boolean(options.fastMode);
  const [base, threshold170, threshold185] = await Promise.all([
    preprocessBase(buffer),
    preprocessThreshold(buffer, 170),
    preprocessThreshold(buffer, 185),
  ]);

  return {
    base,
    threshold170,
    threshold185: fastMode ? null : threshold185,
  };
}

async function cropRelative(buffer, zone, expand = {}) {
  const meta = await sharp(buffer).metadata();

  let left = Math.floor(meta.width * zone.x);
  let top = Math.floor(meta.height * zone.y);
  let width = Math.floor(meta.width * zone.w);
  let height = Math.floor(meta.height * zone.h);

  if (expand.x) {
    const dx = Math.floor(meta.width * expand.x);
    left = Math.max(0, left - dx);
    width = Math.min(meta.width - left, width + dx * 2);
  }

  if (expand.y) {
    const dy = Math.floor(meta.height * expand.y);
    top = Math.max(0, top - dy);
    height = Math.min(meta.height - top, height + dy * 2);
  }

  return sharp(buffer).extract({ left, top, width, height }).png().toBuffer();
}

async function cropAndEnhance(buffer, zone, options = {}) {
  const {
    expandX = 0,
    expandY = 0,
    threshold = null,
    width = 1400,
  } = options;

  let img = sharp(
    await cropRelative(buffer, zone, { x: expandX, y: expandY })
  )
    .rotate()
    .grayscale()
    .normalize()
    .sharpen();

  if (threshold !== null) {
    img = img.threshold(threshold);
  }

  return img.resize({ width, withoutEnlargement: false }).png().toBuffer();
}

async function buildFieldVariants(buffer, zone, options = {}) {
  const width = options.width || 1400;
  const expandX = options.expandX || 0;
  const expandY = options.expandY || 0;
  const fastMode = Boolean(options.fastMode);

  const [base, threshold165, threshold170, threshold185] = await Promise.all([
    cropAndEnhance(buffer, zone, { width, expandX, expandY }),
    cropAndEnhance(buffer, zone, {
      width,
      expandX,
      expandY,
      threshold: 165,
    }),
    cropAndEnhance(buffer, zone, {
      width,
      expandX,
      expandY,
      threshold: 170,
    }),
    cropAndEnhance(buffer, zone, {
      width,
      expandX,
      expandY,
      threshold: 185,
    }),
  ]);

  return {
    base,
    threshold165: fastMode ? null : threshold165,
    threshold170,
    threshold185: fastMode ? null : threshold185,
  };
}

module.exports = {
  preprocessBase,
  preprocessThreshold,
  buildVariants,
  cropRelative,
  cropAndEnhance,
  buildFieldVariants,
};
