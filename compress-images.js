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

async function compressImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return { skipped: true };

  const stats = fs.statSync(filePath);
  const originalKB = (stats.size / 1024).toFixed(1);

  if (stats.size < 100 * 1024) {
    console.log(`  SKIP (${originalKB}KB) ${path.basename(filePath)}`);
    return { skipped: true };
  }

  const isProduct = filePath.includes('product-images');
  const maxW = isProduct ? PRODUCT_MAX_WIDTH : MAX_WIDTH;

  try {
    // Read file into buffer first to avoid file locking issues
    const inputBuffer = fs.readFileSync(filePath);
    
    const meta = await sharp(inputBuffer).metadata();
    
    let pipeline = sharp(inputBuffer).rotate();

    if (meta.width && meta.width > maxW) {
      pipeline = pipeline.resize(maxW, null, { withoutEnlargement: true });
    }

    let outputBuffer;

    if (ext === '.png') {
      outputBuffer = await pipeline.png({ quality: 80, compressionLevel: 9 }).toBuffer();
    } else {
      outputBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    }

    const newKB = (outputBuffer.length / 1024).toFixed(1);
    const savings = (((stats.size - outputBuffer.length) / stats.size) * 100).toFixed(0);

    if (outputBuffer.length < stats.size) {
      fs.writeFileSync(filePath, outputBuffer);
      console.log(`  ✅ ${path.basename(filePath)}: ${originalKB}KB → ${newKB}KB (-${savings}%)`);
      return { before: stats.size, after: outputBuffer.length };
    } else {
      console.log(`  ⏭️  ${path.basename(filePath)}: already optimal (${originalKB}KB)`);
      return { before: stats.size, after: stats.size };
    }
  } catch (err) {
    console.error(`  ❌ ${path.basename(filePath)}: ${err.message}`);
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

    console.log(`\n📁 ${dir}/`);

    const files = fs.readdirSync(fullDir)
      .filter(f => ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f).toLowerCase()))
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
  console.log(`\n${'━'.repeat(44)}`);
  console.log(`📊 Total: ${(totalBefore / (1024*1024)).toFixed(1)}MB → ${(totalAfter / (1024*1024)).toFixed(1)}MB`);
  console.log(`💾 Saved: ${savedMB}MB across ${count} images`);
  console.log(`${'━'.repeat(44)}\n`);
}

main().catch(console.error);
