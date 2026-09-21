import { expect, it } from 'vitest';
import { englishSearchQuery, expandKeywords } from './keywords.js';
import { automaticTags } from '../electron/library/tags.js';

it('expands both language directions without translating unknown brand names away', () => {
  expect(expandKeywords('office team')).toEqual(expect.arrayContaining(['办公室', '团队']));
  expect(englishSearchQuery('办公室 团队 Acme')).toBe('office team acme');
  expect(englishSearchQuery('我的品牌')).toBe('我的品牌');
  expect(expandKeywords('concatenate')).not.toContain('猫');
});
it('generates explainable media tags without claiming filename words were visually detected', () => {
  expect(automaticTags({ filePath: '/media/office/team-meeting.mp4', type: 'video', width: 1920, height: 1080, transcript: '' }))
    .toEqual(expect.arrayContaining(['办公室', '团队', '会议', '横屏', '高清', '视频']));
});
