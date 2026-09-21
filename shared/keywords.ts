// Small, editable bilingual vocabulary. Unknown terms are preserved for manual searches.
export const KEYWORD_GROUPS = [
  ['自然', 'nature'], ['城市', 'city', 'urban'], ['海洋', '大海', '海边', 'ocean', 'sea', 'beach'],
  ['森林', '树林', 'forest', 'woods'], ['山', '山脉', 'mountain'], ['天空', 'sky'], ['日落', '夕阳', 'sunset'],
  ['工作', '办公', '办公室', 'office', 'work'], ['团队', '合作', 'team', 'teamwork'], ['会议', 'meeting'],
  ['科技', '技术', 'technology', 'tech'], ['电脑', 'computer', 'laptop'], ['手机', 'phone', 'smartphone'],
  ['产品', '商品', 'product'], ['购物', '电商', 'shopping', 'ecommerce'], ['商业', '商务', 'business'],
  ['咖啡', 'coffee'], ['美食', '食物', 'food'], ['烹饪', '做饭', 'cooking'], ['旅行', '旅游', 'travel'],
  ['运动', '健身', 'fitness', 'sport'], ['跑步', 'running'], ['家庭', '家人', 'family'], ['儿童', '孩子', 'children'],
  ['宠物', 'pet'], ['猫', 'cat'], ['狗', 'dog'], ['汽车', 'car'], ['人物', 'people', 'person'],
  ['快乐', '开心', 'happy'], ['平静', '舒缓', 'calm', 'relaxing'], ['励志', '激励', 'inspiring', 'motivational'],
  ['背景音乐', '配乐', 'bgm', 'music'], ['音效', 'sfx', 'sound effect'], ['钢琴', 'piano'], ['吉他', 'guitar'],
  ['雨', '雨声', 'rain'], ['风', '风声', 'wind'], ['掌声', 'applause']
] as const;

function matches(text: string, word: string): boolean {
  return /[\u3400-\u9fff]/u.test(word) ? text.includes(word)
    : new RegExp(`(?:^|[^a-z])${word}(?:$|[^a-z])`, 'u').test(text);
}
export function expandKeywords(text: string): string[] {
  const normalized = text.toLowerCase();
  const original = normalized.split(/[\s_,，。;；\-.]+/u).filter(Boolean);
  return [...new Set([...original, ...KEYWORD_GROUPS.filter(group => group.some(word => matches(normalized, word))).flat()])];
}
export function englishSearchQuery(text: string): string {
  let result = text.toLowerCase();
  const replacements = KEYWORD_GROUPS.flatMap(group => {
    const english = group.find(word => /^[a-z ]+$/u.test(word))!;
    return group.filter(word => /[\u3400-\u9fff]/u.test(word)).map(word => ({ word, english }));
  }).sort((a, b) => b.word.length - a.word.length);
  for (const { word, english } of replacements) result = result.replaceAll(word, ` ${english} `);
  return [...new Set(result.trim().split(/\s+/u))].join(' ');
}
