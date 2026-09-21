import { expect, it } from 'vitest';
import { mixArguments } from './mix.js';

it('loops only BGM, ducks against a split narration track, and bounds the mix to narration duration', () => {
  const args = mixArguments('voice.wav', 'mixed.wav', 3500, { path: 'bgm.mp3', volume: .2, ducking: true });
  const graph = args[args.indexOf('-filter_complex') + 1];
  expect(args.slice(args.indexOf('-stream_loop'), args.indexOf('-stream_loop') + 4)).toEqual(['-stream_loop', '-1', '-i', 'bgm.mp3']);
  expect(graph).toContain('[n]asplit=2[voice][side]');
  expect(graph).toContain('sidechaincompress');
  expect(graph).toContain('atrim=duration=3.5');
  expect(graph).toContain('loudnorm=I=-16');
});
it('supports voice-only and unducked mixes and rejects invalid controls', () => {
  expect(mixArguments('voice.wav', 'mixed.wav', 1000).join(' ')).not.toContain('amix');
  expect(mixArguments('voice.wav', 'mixed.wav', 1000, { path: 'bgm.wav', volume: 0, ducking: false }).join(' ')).not.toContain('sidechaincompress');
  expect(() => mixArguments('v', 'o', NaN)).toThrow();
  expect(() => mixArguments('v', 'o', 1000, { path: 'b', volume: 2, ducking: true })).toThrow();
});
