const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const IMAGE_DIRS = [
  'public/myImage',
  'public/product-images',
  'public/images'
];

const MAX_WIDTH = 1200;
const PRODUCT_MAX_WIDTH = 800;
const JPEG_QUALITY = 75;
const WEBP_QUALITY = 70;

function isSupportedImage(filePath) {
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(filePath).toLowerCase());
}

function isSourceImage(filePath) {
  return ['.jpg', '.jpeg', '.png'].includes(path.extname(filePath).toLowerCase());
}

function webpPathFor(filePath) {
  return filePath.replace(/\.(jpe?g|png)$/i, '.webp');
}

async function createWebpVariant(filePath, inputBuffer, maxW) {
  if (!isSourceImage(filePath)) return null;

  const outputPath = webpPathFor(filePath);
  const meta = await sharp(inputBuffer).metadata();
  let pipeline = sharp(inputBuffer).rotate();

  if (meta.width && meta.width > maxW) {
    pipeline = pipeline.resize(maxW, null, { withoutEnlargement: true });
  }

  const outputBuffer = await pipeline.webp({ quality: WEBP_QUALITY, effort: 5 }).toBuffer();
  const existingSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : Infinity;

  if (outputBuffer.length >= inputBuffer.length) {
    if (fs.existsSync(outputPath) && existingSize >= inputBuffer.length) {
      fs.unlinkSync(outputPath);
    }
    return null;
  }

  if (outputBuffer.length < existingSize) {
    fs.writeFileSync(outputPath, outputBuffer);
  }

  return { path: outputPath, size: Math.min(outputBuffer.length, existingSize) };
}

async function compressImage(filePath) {
  if (!isSupportedImage(filePath)) return { skipped: true };

  const stats = fs.statSync(filePath);
  const originalKB = (stats.size / 1024).toFixed(1);
  const isProduct = filePath.includes('product-images');
  const maxW = isProduct ? PRODUCT_MAX_WIDTH : MAX_WIDTH;

  if (stats.size < 100 * 1024 && !isSourceImage(filePath)) {
    console.log(`  SKIP (${originalKB}KB) ${path.basename(filePath)}`);
    return { skipped: true };
  }

  try {
    const inputBuffer = fs.readFileSync(filePath);
    const meta = await sharp(inputBuffer).metadata();
    let pipeline = sharp(inputBuffer).rotate();

    if (meta.width && meta.width > maxW) {
      pipeline = pipeline.resize(maxW, null, { withoutEnlargement: true });
    }

    let outputBuffer = inputBuffer;
    if (path.extname(filePath).toLowerCase() === '.png') {
      outputBuffer = await pipeline.png({ quality: 80, compressionLevel: 9 }).toBuffer();
    } else if (path.extname(filePath).toLowerCase() !== '.webp') {
      outputBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    }

    let afterSize = stats.size;
    if (outputBuffer.length < stats.size) {
      fs.writeFileSync(filePath, outputBuffer);
      afterSize = outputBuffer.length;
      const newKB = (outputBuffer.length / 1024).toFixed(1);
      const savings = (((stats.size - outputBuffer.length) / stats.size) * 100).toFixed(0);
      console.log(`  OK ${path.basename(filePath)}: ${originalKB}KB -> ${newKB}KB (-${savings}%)`);
    } else {
      console.log(`  OK ${path.basename(filePath)}: already optimal (${originalKB}KB)`);
    }

    const webp = await createWebpVariant(filePath, outputBuffer, maxW);
    if (webp) console.log(`     WEBP ${path.basename(webp.path)}: ${(webp.size / 1024).toFixed(1)}KB`);

    return { before: stats.size, after: afterSize, webp };
  } catch (err) {
    console.error(`  ERROR ${path.basename(filePath)}: ${err.message}`);
    return { before: stats.size, after: stats.size, error: true };
  }
}

async function main() {
  let totalBefore = 0;
  let totalAfter = 0;
  let count = 0;

  for (const dir of IMAGE_DIRS) {
    const fullDir = path.resolve(__dirname, dir);
    if (!fs.existsSync(fullDir)) continue;

    console.log(`\n${dir}/`);

    const files = fs.readdirSync(fullDir)
      .filter(f => isSupportedImage(f))
      .map(f => path.join(fullDir, f));

    for (const f of files) {
      const result = await compressImage(f);
      if (!result.skipped) {
        totalBefore += result.before || 0;
        totalAfter += result.after || 0;
        count++;
      }
    }
  }

  const savedMB = ((totalBefore - totalAfter) / (1024 * 1024)).toFixed(1);
  console.log('\n--------------------------------------------');
  console.log(`Total: ${(totalBefore / (1024 * 1024)).toFixed(1)}MB -> ${(totalAfter / (1024 * 1024)).toFixed(1)}MB`);
  console.log(`Saved: ${savedMB}MB across ${count} images`);
  console.log('--------------------------------------------\n');
}

main().catch(console.error);
