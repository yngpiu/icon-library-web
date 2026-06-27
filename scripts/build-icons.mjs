import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';

const inputDir = path.join(process.cwd(), 'src/assets/icons');
const outputDir = path.join(process.cwd(), 'public', 'icons');
const manifestFile = path.join(outputDir, 'manifest.json');

async function getIconFiles(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map(dirent => {
      const res = path.resolve(dir, dirent.name);
      return dirent.isDirectory() ? getIconFiles(res) : res;
    })
  );
  return files.flat().filter(file => file.endsWith('.svg'));
}

async function buildIcons() {
  console.log('Starting icon build...');
  await mkdir(outputDir, { recursive: true });

  const iconFiles = await getIconFiles(inputDir);
  console.log(`Found ${iconFiles.length} icons.`);

  const limit = pLimit(100);

  const allIcons = await Promise.all(
    iconFiles.map(file =>
      limit(async () => {
        let content = await readFile(file, 'utf-8');
        // Strip fill attributes — SVGs inherit color from CSS currentColor
        content = content.replace(/fill="[^"]*"/gi, '');
        const relativePath = path.relative(inputDir, file);

        const parts = relativePath.split(path.sep);
        const collection = parts.shift();
        const filename = parts.pop();
        const name = path.basename(filename, '.svg');

        let style, category;

        // General logic for parsing styles and categories
        switch (collection) {
          case 'font-awesome':
            // Structure: font-awesome/{style}/{...category}/{icon}.svg
            style = parts.shift() || 'default';
            category = parts.join(path.sep) || 'general';
            break;
          case 'panda':
            // Structure: panda/{style}/{icon}.svg
            style = parts.shift() || 'default';
            category = 'general';
            break;
          case 'huge':
          default:
            // Structure: huge/{category}/{style}/{icon}.svg
            category = parts.shift() || 'general';
            style = parts.shift() || 'default';
            break;
        }

        return {
          name,
          collection,
          category,
          style,
          path: relativePath,
          content,
        };
      })
    )
  );

  const iconsByCollection = allIcons.reduce((acc, icon) => {
    if (!acc[icon.collection]) {
      acc[icon.collection] = [];
    }
    acc[icon.collection].push(icon);
    return acc;
  }, {});

  for (const collectionName in iconsByCollection) {
    const icons = iconsByCollection[collectionName];

    // Metadata only (no content) — small, fast to load
    const metaFile = path.join(outputDir, `${collectionName}.json`);
    const metadata = icons.map(({ name, collection, category, style, path }) => ({
      name, collection, category, style, path,
    }));
    await writeFile(metaFile, JSON.stringify(metadata));
    console.log(`Built ${metadata.length} metadata entries to ${metaFile}`);

    // Chunked content files — loaded in background, 1000 icons per chunk
    const CHUNK_SIZE = 1000;
    const content = icons.map(icon => icon.content);
    const chunks = Math.ceil(content.length / CHUNK_SIZE);
    for (let i = 0; i < chunks; i++) {
      const chunk = content.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const chunkFile = path.join(outputDir, `${collectionName}.content.${i}.json`);
      await writeFile(chunkFile, JSON.stringify(chunk));
    }
    // Content index so the app knows how many chunks to fetch
    const idxFile = path.join(outputDir, `${collectionName}.content.idx.json`);
    await writeFile(idxFile, JSON.stringify({ count: chunks, size: content.length }));
    console.log(`Built ${content.length} content strings across ${chunks} chunks`);
  }

  const manifest = {
    collections: Object.keys(iconsByCollection).sort(),
  };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  console.log('Successfully created manifest file.');
}

buildIcons().catch(err => {
  console.error('Error building icons:', err);
  process.exit(1);
});
