import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const REQUIRED_FILES = [
  'engine/qwen_tts.exe',
  'engine/libopenblas.dll',
  'engine/libwinpthread-1.dll',
  'engine/QWEN3-TTS-C-LICENSE',
  'engine/INGOT-LICENSE',
  'engine/OPENBLAS-LICENSE',
  'engine/LZ4-LICENSE',
  'engine/WINPTHREADS-LICENSE',
  'engine/THIRD-PARTY-NOTICES.txt',
  'engine/build-info.json',
  'engine/manifest.json',
  'models/qwen3-tts-0.6b-customvoice/config.json',
  'models/qwen3-tts-0.6b-customvoice/generation_config.json',
  'models/qwen3-tts-0.6b-customvoice/tokenizer_config.json',
  'models/qwen3-tts-0.6b-customvoice/preprocessor_config.json',
  'models/qwen3-tts-0.6b-customvoice/model.safetensors',
  'models/qwen3-tts-0.6b-customvoice/vocab.json',
  'models/qwen3-tts-0.6b-customvoice/merges.txt',
  'models/qwen3-tts-0.6b-customvoice/speech_tokenizer/config.json',
  'models/qwen3-tts-0.6b-customvoice/speech_tokenizer/configuration.json',
  'models/qwen3-tts-0.6b-customvoice/speech_tokenizer/preprocessor_config.json',
  'models/qwen3-tts-0.6b-customvoice/speech_tokenizer/model.safetensors',
  'models/qwen3-tts-0.6b-customvoice/MODEL-LICENSE.txt',
  'models/qwen3-tts-0.6b-customvoice/manifest.json',
  'models/qwen3-tts-0.6b-base/config.json',
  'models/qwen3-tts-0.6b-base/generation_config.json',
  'models/qwen3-tts-0.6b-base/tokenizer_config.json',
  'models/qwen3-tts-0.6b-base/preprocessor_config.json',
  'models/qwen3-tts-0.6b-base/model.safetensors',
  'models/qwen3-tts-0.6b-base/vocab.json',
  'models/qwen3-tts-0.6b-base/merges.txt',
  'models/qwen3-tts-0.6b-base/speech_tokenizer/config.json',
  'models/qwen3-tts-0.6b-base/speech_tokenizer/configuration.json',
  'models/qwen3-tts-0.6b-base/speech_tokenizer/preprocessor_config.json',
  'models/qwen3-tts-0.6b-base/speech_tokenizer/model.safetensors',
  'models/qwen3-tts-0.6b-base/MODEL-LICENSE.txt',
  'models/qwen3-tts-0.6b-base/manifest.json',
  'models/sensevoice-small/model.int8.onnx',
  'models/sensevoice-small/tokens.txt',
  'models/sensevoice-small/silero_vad.onnx',
  'models/sensevoice-small/SENSEVOICE-LICENSE',
  'models/sensevoice-small/SENSEVOICE-MODEL-LICENSE',
  'models/sensevoice-small/SILERO-LICENSE',
  'models/sensevoice-small/manifest.json',
  'ffmpeg/ffmpeg.exe',
  'ffmpeg/ffprobe.exe',
  'ffmpeg/LICENSE.txt',
  'ffmpeg/manifest.json',
  'cli/voxweave.cmd'
];

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function listFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (entry.isFile()) files.push(normalize(path.relative(root, absolute)));
  }
  return files;
}

async function verifyDeclaredHashes(root, relativeManifest) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, relativeManifest), 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return [];
    return [`${relativeManifest}: manifest is not valid JSON`];
  }
  const descriptorGroups = [manifest.files ?? {}, manifest.notices ?? {}];
  const descriptors = descriptorGroups.flatMap(group => Array.isArray(group) ? group : Object.values(group));
  const failures = [];
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.path !== 'string' || !descriptor.sha256) continue;
    const relative = normalize(path.join(path.dirname(relativeManifest), descriptor.path));
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      failures.push(`${relativeManifest}: resource path escapes root`);
      continue;
    }
    try {
      const actual = await sha256(absolute);
      if (actual !== descriptor.sha256.toLowerCase()) failures.push(`${relative}: SHA-256 mismatch`);
    } catch {
      failures.push(`${relative}: declared file is missing`);
    }
  }
  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] : path.join(process.cwd(), 'resources'));
  const writeManifest = args.includes('--write-manifest');
  const missing = [];
  for (const relative of REQUIRED_FILES) {
    try {
      const info = await stat(path.join(root, relative));
      if (!info.isFile() || info.size === 0) missing.push(relative);
    } catch {
      missing.push(relative);
    }
  }

  if (missing.length) {
    console.error(`Offline resource closure is incomplete (${missing.length} missing):`);
    for (const relative of missing) console.error(`  - ${relative}`);
  }

  const hashFailures = [
    ...await verifyDeclaredHashes(root, 'engine/manifest.json'),
    ...await verifyDeclaredHashes(root, 'models/qwen3-tts-0.6b-customvoice/manifest.json'),
    ...await verifyDeclaredHashes(root, 'models/qwen3-tts-0.6b-base/manifest.json'),
    ...await verifyDeclaredHashes(root, 'models/sensevoice-small/manifest.json'),
    ...await verifyDeclaredHashes(root, 'ffmpeg/manifest.json')
  ];
  if (hashFailures.length) {
    console.error('Offline resource hash verification failed:');
    for (const failure of hashFailures) console.error(`  - ${failure}`);
  }
  if (missing.length || hashFailures.length) {
    process.exitCode = 1;
    return;
  }

  const relativeFiles = (await listFiles(root))
    .filter(relative => relative !== '.gitkeep' && relative !== 'offline-manifest.json')
    .sort();
  const files = [];
  for (const relative of relativeFiles) {
    const absolute = path.join(root, relative);
    const info = await stat(absolute);
    files.push({ path: relative, size: info.size, sha256: await sha256(absolute) });
  }
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    layout: 'directory-portable',
    files
  };
  if (writeManifest) {
    await writeFile(path.join(root, 'offline-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  console.log(`Offline resources verified: ${files.length} files, ${totalBytes} bytes${writeManifest ? '; manifest written' : ''}.`);
}

await main();
