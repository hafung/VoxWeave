import { Jieba, TfIdf } from '@node-rs/jieba';
import { dict, idf } from '@node-rs/jieba/dict.js';

const jieba = Jieba.withDict(dict);
const tfIdf = TfIdf.withDict(idf);
const punctuation = /^[\p{P}\p{S}\s]+$/u;

export function segmentChinese(text: string): string[] {
  return jieba.cut(text, true).filter(token => token.trim() && !punctuation.test(token));
}

export function extractChineseKeywords(text: string, limit = 5): string[] {
  return tfIdf.extractKeywords(jieba, text, limit)
    .map(item => item.keyword.trim())
    .filter(keyword => keyword.length > 1 && !punctuation.test(keyword));
}

export function loadProjectDictionary(entries: string[]): void {
  const normalized = entries.map(entry => entry.trim()).filter(Boolean);
  if (normalized.length) jieba.loadDict(Buffer.from(normalized.join('\n'), 'utf8'));
}
