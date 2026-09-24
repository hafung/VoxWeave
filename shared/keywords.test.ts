import { expect, it } from 'vitest';
import { englishSearchQuery, expandKeywords } from './keywords.js';
import { automaticTags, cleanAutomaticTags } from '../electron/library/tags.js';

it('expands both language directions without translating unknown brand names away', () => {
  expect(expandKeywords('office team')).toEqual(expect.arrayContaining(['办公室', '团队']));
  expect(englishSearchQuery('办公室 团队 Acme')).toBe('office team acme');
  expect(englishSearchQuery('我的品牌')).toBe('我的品牌');
  expect(englishSearchQuery('城市夜景')).toBe('city night');
  expect(expandKeywords('concatenate')).not.toContain('猫');
});
it('generates explainable media tags without claiming filename words were visually detected', () => {
  expect(automaticTags({ filePath: '/media/office/team-meeting.mp4', type: 'video', width: 1920, height: 1080, transcript: '' }))
    .toEqual(expect.arrayContaining(['办公室', '团队', '会议', '横屏', '高清', '视频']));
});
it('ignores Pexels download IDs, UUID fragments, and generic storage folders', () => {
  const tags = automaticTags({
    filePath: '/library/downloads/pexels-video-34835534-a5610480-222b-4001-be1c-71395da395b5.mp4',
    name: 'city night · 34835534', type: 'video', width: 1920, height: 1080, transcript: '',
    license: { status: 'licensed', source: 'pexels' }
  });
  expect(tags).toEqual(expect.arrayContaining(['city', 'night', '城市', 'urban', '视频', '横屏', '高清']));
  expect(tags).not.toEqual(expect.arrayContaining(['pexels', 'video', 'downloads', '34835534', 'a5610480']));
  expect(cleanAutomaticTags([...tags, '222b', '4001', 'be1c', '71395da395b5', 'downloads'])).toEqual(tags);
});
