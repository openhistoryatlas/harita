// Libraries of folders: battles, images and zones, in content/shared/ for every story or in a story's shared/. A folder
// that holds its own file is an item, named by the folder. Any other folder is a group that only orders the library.
import fs from 'fs';
import path from 'path';

export const isImage = d => fs.readdirSync(d).some(f => /^image\.\w+$/.test(f)); // image.yaml or the image itself
export const isBattle = d => fs.existsSync(path.join(d, 'battle.yaml')) || fs.existsSync(path.join(d, 'pages'));
export const isZone = d => fs.existsSync(path.join(d, 'zone.geojson'));

// The items below dir at any depth, by folder name. rel names the folders in the error for one name in two groups.
export function libraryItems(dir, isItem, rel = p => p) {
  const items = new Map();
  const walk = d => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (name.startsWith('.') || !fs.statSync(full).isDirectory()) continue;
      if (!isItem(full)) { walk(full); continue; }
      if (items.has(name)) throw new Error(`${rel(items.get(name))} and ${rel(full)} have one name, rename one`);
      items.set(name, full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return items;
}
