// Battle folders: content/<story>/shared/battles/<id>/ for one story, content/shared/battles/<id>/ for every story.
import fs from 'fs';
import path from 'path';

// The folders that hold battle id, by exact name, so the answer is the same on a file system that ignores case.
export function battleDirs(content, storyDir, id) {
  return [path.join(storyDir, 'shared', 'battles'), path.join(content, 'shared', 'battles')]
    .filter(d => fs.existsSync(d) && fs.readdirSync(d).includes(id)).map(d => path.join(d, id));
}
