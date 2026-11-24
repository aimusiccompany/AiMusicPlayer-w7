const fs = require('node:fs');
const path = require('node:path');

// Remove once the pinned Virtual Player version accepts an exact-fit slot.
const controller = path.join(__dirname, '../node_modules/@ai-music-corp/virtual-player/dist/controllers/special-ad-controller.js');
const original = 'currentTime + s.specialAd.audios[audioIndex].duration < s.endTime';
const corrected = 'currentTime + s.specialAd.audios[audioIndex].duration <= s.endTime';
const source = fs.readFileSync(controller, 'utf8');
if (!source.includes(corrected)) {
  if (!source.includes(original)) throw new Error('Virtual Player exact schedule patch no longer matches');
  fs.writeFileSync(controller, source.replace(original, corrected));
}
