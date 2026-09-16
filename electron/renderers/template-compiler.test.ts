import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDraftEditPlan } from '../../shared/edit-plan.js';
import { resolveEditPlan } from '../composition/resolver.js';
import { compileFixedTemplate, escapeHtml } from './template-compiler.js';

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map(item => rm(item, { recursive: true, force: true }))));

function wav(): Buffer {
  const output = Buffer.alloc(44 + 48_000);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVE', 8);
  output.write('fmt ', 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22); output.writeUInt32LE(24_000, 24); output.writeUInt32LE(48_000, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write('data', 36);
  output.writeUInt32LE(48_000, 40); return output;
}

describe('fixed composition compiler', () => {
  it('escapes all user text and emits local-only runtime assets', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voxweave-template-')); temporary.push(root);
    const narrationPath = path.join(root, 'narration.wav'); await writeFile(narrationPath, wav());
    const draft = createDraftEditPlan({ id: 'template', script: '<img src=x onerror=alert(1)>。', voiceId: 'vivian' });
    const plan = resolveEditPlan(draft, { narration: {
      audioPath: narrationPath, durationMs: 1000,
      segments: [{ id: 'scene-001', text: draft.scenes[0].script, startMs: 0, endMs: 1000, audioPath: narrationPath }]
    }});
    const prepared = await compileFixedTemplate(plan, path.join(root, 'preview'));
    const html = await readFile(prepared.entryUrl, 'utf8');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/https?:\/\//u);
    expect(html).toContain("default-src 'self'");
    expect(html).not.toContain('#stage>[data-start]{position:absolute;inset:0;opacity:0}');
    expect(html).toContain('data-composition-id="voxweave-kinetics"');
    expect(html).toContain('data-composition-id="voxweave-captions"');
    expect(html).toContain('data-timeline-role="captions"');
    expect(html).toContain('timedLayer("#kinetic-layer>[data-animate-start]"');
    expect(html).toContain('tl.set(el,{autoAlpha:1},start)');
    expect(html).toContain('class="clip" src="./assets/narration.wav"');
  });

  it('escapes HTML-significant characters', () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
  });
});
