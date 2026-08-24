/**
 * B10 · clean.split —— 文本清洗与章节切分（确定性为主）
 *
 * 职责：
 * 1. 编码探测（UTF-8 BOM / UTF-16 BOM / UTF-8 / GB18030 / Big5 / UTF-16 无 BOM 启发式）
 * 2. 去除常见盗版站水印、广告行、重复行、文末“全文完”标记
 * 3. 段落重排：把硬换行打断的短行合并成完整段落
 * 4. 章节标题识别 + 切分；无标题时按约 5000 字兜底切段
 * 5. 输出清洗报告（删除行数 / 去重行数 / 警告）
 *
 * 注意：本模块是纯函数，不访问 DB/R2，方便单测与命令行复用。
 */

export type ChapterKind = "chapter" | "part" | "front" | "segment";

export interface CleanedChapter {
  /** 章序号：前言=0，正文章从 1 开始 */
  idx: number;
  title: string | null;
  kind: ChapterKind;
  /** 该章对应的原文（清洗后、重排前的行，用于留证） */
  rawText: string;
  /** 清洗 + 段落重排后的正文（段落间 \n\n） */
  cleanedText: string;
  charCount: number;
  parseMeta: Record<string, unknown>;
}

export interface CleanReport {
  /** 水印/广告/符号行删除数 */
  removedLines: number;
  /** 跨行去重删除的重复行数 */
  dedupedLines: number;
  /** 是否删除过“全文完/全书完”类文末标记 */
  tailRemoved: boolean;
  /** 硬换行合并为段落的次数 */
  mergedLineBreaks: number;
  /** 识别并跳过的目录（TOC）行数 */
  tocLinesSkipped: number;
}

export interface CleanResult {
  encoding: string;
  chapters: CleanedChapter[];
  totalChars: number;
  warnings: string[];
  report: CleanReport;
}

const BOMS: Array<{ bytes: number[]; encoding: string }> = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" },
];

/** 水印/广告行（盗版站常见） */
const WATERMARK_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /www\./i,
  /(微信|公众号|关注).{0,12}(公众号|微信)/,
  /(本书|全文|小说).{0,10}(来自|更新|下载|阅读|首发)/,
  /(txt|TXT)(下载|全集|全本|精校|无错)/,
  /(请|更多).{0,8}(收藏|推荐|支持|分享)/,
  /(手机|电脑|客户端).{0,6}(阅读|访问)/,
  /(最快更新|持续更新|每日更新|更新最快)/,
  /(版权归|版权所有|未经授权|侵权请联系)/,
  /(求月票|求推荐|求收藏|求订阅)/,
  /(请记住|记住)(本站|网站|网址|域名)/,
  /(收藏本站|加入书签|推荐票|月票|打赏)/,
  /(无弹窗|无广告|弹窗|广告).{0,10}(阅读|小说|txt|下载)/,
  /(防盗|防屏蔽|防采集|乱码)/,
  /本章(未完|由|出自|来源|开始|结束)/,
  /^[=*_\-~—]{4,}$/,
];

/** 文末完本标记（单独成行时才删除） */
const TAIL_MARKER_RE =
  /^[\s　]*(全书完|全文完|完本|剧终|全書完|全書完結|（全书完）|\(全书完\)|（全文完）|\(全文完\)|（完）|\(完\)|（劇終）)[\s　]*$/u;

/** 章节标题：第X章/回/节/卷/部/集，X 支持中文数字与阿拉伯数字，允许“正文”前缀 */
const CHAPTER_HEADING_RE =
  /^[\s　]*(?:正文[\s　]*)?第[\s]*([0-9零〇一二三四五六七八九十百千万两]{1,12})[\s]*([章回节]|[卷部集])[\s　]*([^\n]{0,80})?$/u;

/** 卷首标题：卷X / 卷三 等 */
const VOLUME_HEADING_RE =
  /^[\s　]*卷[\s]*([0-9零〇一二三四五六七八九十百千万两]{1,12})[\s　]*([^\n]{0,80})?$/u;

/** 英文章节标题：Chapter 1 / CHAPTER 2: Title */
const CHAPTER_HEADING_EN_RE =
  /^[\s　]*chapter[\s.]*([0-9]{1,4})[\s:：]*([^\n]{0,80})?$/i;

/** Chap.N 结构标记：正文常见“Chap.1”+ 下一行“第一章”分行；目录常见“Chap.1　第一章　标题” */
const CHAP_MARKER_RE =
  /^[\s　]*chap(?:ter)?\.?\s*([0-9]{1,4})[\s　:：]*([^\n]{0,80})?$/i;

/** 特殊章节标题：序章/楔子/引子/尾声/终章/后记/番外 */
const SPECIAL_HEADING_RE =
  /^[\s　]*(序章|序言|楔子|引子|尾声|终章|后记|番外|外传)[\s　]*([^\n]{0,80})?$/u;

const NON_TEXT_LINE_RE = /^[\s　.,，。、；;：:!！?？·…—\-"'“”‘’()（）\[\]【】<>《》*~=]+$/;

const SENTENCE_END_RE = /[。．.！？!?…—~～"'"”"’」』）)]$/u;

function isBom(buf: Uint8Array, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function countReplacementChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (ch === "\uFFFD") n += 1;
  }
  return n;
}

function countCjkChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      n += 1;
    }
  }
  return n;
}

function countControlChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 && ch !== "\n" && ch !== "\t" && ch !== "\r") n += 1;
  }
  return n;
}

/** 简化字常用字（用于在 GB18030/Big5 之间选择） */
const SIMPLIFIED_MARKERS = "的了是我你他个们这说还过没到会里为";
/** 繁体常用字（Big5 文本中远高于 GBK 文本） */
const TRADITIONAL_MARKERS = "個們這說還過沒到會裡為妳後來麼";

function countMarkers(text: string, markers: string): number {
  let n = 0;
  for (const ch of text) {
    if (markers.includes(ch)) n += 1;
  }
  return n;
}

interface DecodeCandidate {
  encoding: string;
  text: string;
  score: number;
  utf16Suspicious: boolean;
}

function looksLikeUtf16(buf: Uint8Array, littleEndian: boolean): boolean {
  if (buf.length < 4) return false;
  const sample = Math.min(buf.length, 400);
  let oddZero = 0;
  let evenZero = 0;
  for (let i = 0; i < sample; i++) {
    if (buf[i] !== 0) continue;
    if (i % 2 === (littleEndian ? 1 : 0)) oddZero += 1;
    else evenZero += 1;
  }
  // 中文 UTF-16 的 ASCII 字节几乎都落在一侧，另一侧应为 0
  const half = sample / 2;
  return oddZero > half * 0.35 && evenZero < oddZero * 0.25;
}

function scoreDecodedText(text: string, encoding: string, utf16Suspicious: boolean): number {
  const cjk = countCjkChars(text);
  const total = Math.max(1, text.length);
  const cjkRatio = cjk / total;
  const simplified = countMarkers(text, SIMPLIFIED_MARKERS);
  const traditional = countMarkers(text, TRADITIONAL_MARKERS);
  const replacement = countReplacementChars(text);
  const controls = countControlChars(text);

  let score = cjkRatio * 100;
  // 常见 CJK 字越多，越像正确解码
  score += Math.min(simplified + traditional, 2000) * 0.002;
  score -= replacement * 3;
  score -= controls * 1.5;

  if (encoding === "gb18030") {
    score += simplified * 0.015;
    score -= traditional * 0.02;
  } else if (encoding === "big5") {
    score += traditional * 0.015;
    score -= simplified * 0.02;
  } else if (encoding === "utf-8") {
    score += 1.5; // 无 BOM 时优先 UTF-8
  }

  if (utf16Suspicious) score -= 15; // 字节模式不像 UTF-16 时惩罚

  return score;
}

/** 探测编码并解码为 JS 字符串 */
export function detectAndDecode(buf: Uint8Array): { text: string; encoding: string } {
  for (const bom of BOMS) {
    if (isBom(buf, bom.bytes)) {
      const body = buf.subarray(bom.bytes.length);
      const text = new TextDecoder(bom.encoding, { fatal: false }).decode(body);
      return { text, encoding: bom.encoding };
    }
  }

  const candidates: DecodeCandidate[] = [];

  const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  candidates.push({
    encoding: "utf-8",
    text: utf8Text,
    score: 0,
    utf16Suspicious: false,
  });

  for (const encoding of ["gb18030", "big5"] as const) {
    const text = new TextDecoder(encoding, { fatal: false }).decode(buf);
    candidates.push({ encoding, text, score: 0, utf16Suspicious: false });
  }

  // 无 BOM UTF-16：很多 txt 导出器会省略 BOM，靠 0 字节分布启发式识别
  const utf16leSuspicious = !looksLikeUtf16(buf, true);
  candidates.push({
    encoding: "utf-16le",
    text: new TextDecoder("utf-16le", { fatal: false }).decode(buf),
    score: 0,
    utf16Suspicious: utf16leSuspicious,
  });
  const utf16beSuspicious = !looksLikeUtf16(buf, false);
  candidates.push({
    encoding: "utf-16be",
    text: new TextDecoder("utf-16be", { fatal: false }).decode(buf),
    score: 0,
    utf16Suspicious: utf16beSuspicious,
  });

  for (const c of candidates) {
    c.score = scoreDecodedText(c.text, c.encoding, c.utf16Suspicious);
  }
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  return { text: best.text, encoding: best.encoding };
}

/** 判断一行是否以句子结束标点结尾（段落边界） */
export function isSentenceEnd(line: string): boolean {
  const trimmed = line.trimEnd();
  if (!trimmed) return true;
  return SENTENCE_END_RE.test(trimmed);
}

/** 相邻两段合并时的连接符：中英混排时英文单词间补空格 */
function joinChar(prev: string, next: string): string {
  const last = prev.slice(-1);
  const first = next.slice(0, 1);
  if (/[a-zA-Z0-9]/.test(last) && /[a-zA-Z0-9]/.test(first)) return " ";
  return "";
}

/**
 * 段落重排：把硬换行打断的短行合并成完整段落。
 * 规则：行尾是句子结束标点（。！？… 等）→ 段落结束；否则继续向后合并。
 * 单段落超过 800 字时强制分段，避免整章连成一片。
 */
export function reflowParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let buffer = "";
  let bufferChars = 0;

  const flush = () => {
    if (buffer) {
      paragraphs.push(buffer);
      buffer = "";
      bufferChars = 0;
    }
  };

  for (const line of lines) {
    if (!line) continue;
    if (buffer) {
      buffer += joinChar(buffer, line) + line;
      bufferChars += line.replace(/\s/g, "").length;
    } else {
      buffer = line;
      bufferChars = line.replace(/\s/g, "").length;
    }

    if (isSentenceEnd(line) || bufferChars >= 800) flush();
  }
  flush();
  return paragraphs;
}

interface NormalizeOutcome {
  lines: string[];
  removedLines: number;
  dedupedLines: number;
  tailRemoved: boolean;
}

/** 去除 BOM、统一换行、去水印/符号行、跨行去重、去文末标记 */
export function normalizeLinesDetailed(text: string): NormalizeOutcome {
  const withoutBom = text.replace(/^\uFEFF/, "");
  const normalized = withoutBom.replace(/\r\n?|\r/g, "\n");

  const rawLines = normalized.split("\n");
  let removedLines = 0;
  let tailRemoved = false;

  // 第一遍：逐行清洗，只保留正文候选行
  const cleaned: string[] = [];
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (NON_TEXT_LINE_RE.test(line)) {
      removedLines += 1;
      continue;
    }
    if (WATERMARK_PATTERNS.some((re) => re.test(line))) {
      removedLines += 1;
      continue;
    }
    if (TAIL_MARKER_RE.test(line)) {
      removedLines += 1;
      tailRemoved = true;
      continue;
    }
    cleaned.push(line);
  }

  // 第二遍：跨行去重。短行/水印类行出现 ≥3 次、长行出现 ≥5 次时只保留第一次。
  const freq = new Map<string, number>();
  for (const line of cleaned) freq.set(line, (freq.get(line) ?? 0) + 1);

  const result: string[] = [];
  const seen = new Set<string>();
  let dedupedLines = 0;
  for (const line of cleaned) {
    const count = freq.get(line) ?? 1;
    const suspicious = line.length <= 20 || WATERMARK_PATTERNS.some((re) => re.test(line));
    const threshold = suspicious ? 3 : 5;
    if (count >= threshold) {
      if (seen.has(line)) {
        dedupedLines += 1;
        continue;
      }
      seen.add(line);
    }
    // 相邻重复仍然直接折叠（count < threshold 时的兜底）
    if (result[result.length - 1] === line) {
      dedupedLines += 1;
      continue;
    }
    result.push(line);
  }

  return { lines: result, removedLines, dedupedLines, tailRemoved };
}

/** 兼容旧签名：返回清洗后的行数组 */
export function normalizeLines(text: string): string[] {
  return normalizeLinesDetailed(text).lines;
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 解析章节序号：阿拉伯数字直接解析；中文数字支持 一~万 级（一百二十三 / 一千零一 / 二十） */
export function parseChineseNumber(input: string): number | null {
  if (!input) return null;
  if (/^[0-9]+$/.test(input)) {
    const n = Number(input);
    return Number.isSafeInteger(n) ? n : null;
  }

  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of input) {
    const d = CN_DIGITS[ch];
    if (d !== undefined) {
      digit = d;
      continue;
    }
    if (ch === "十") {
      section += (digit || 1) * 10;
    } else if (ch === "百") {
      section += (digit || 1) * 100;
    } else if (ch === "千") {
      section += (digit || 1) * 1000;
    } else if (ch === "万") {
      section = (section + digit) * 10000;
      total += section;
      section = 0;
    } else {
      return null;
    }
    digit = 0;
  }
  const value = total + section + digit;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

interface Heading {
  title: string | null;
  kind: Exclude<ChapterKind, "front">;
  unit: string;
  /** 解析出的序号（第X章/卷X/Chapter N）；序章/楔子等为 null */
  number: number | null;
  /** 规则置信度 0~1，融合上下文后会调整 */
  confidence: number;
  ruleId: "chapter" | "volume" | "english" | "chap_marker" | "special";
}

interface HeadingContext {
  previousLine?: string;
  previousIsHeading?: boolean;
  /** 最近一次被采纳的章节序号（用于连续性救援） */
  previousChapterNumber?: number | null;
  isFirstHeading?: boolean;
}

/** 规则集合：每条规则独立产生候选，由 detectHeading 融合裁决 */
function buildHeadingCandidates(line: string): Heading[] {
  const candidates: Heading[] = [];

  const m = line.match(CHAPTER_HEADING_RE);
  if (m) {
    const number = parseChineseNumber(m[1]);
    const unit = m[2];
    const title = m[3]?.trim() || null;
    const isPart = unit === "卷" || unit === "部" || unit === "集";
    candidates.push({
      unit,
      kind: isPart ? "part" : "chapter",
      title,
      number,
      confidence: (isPart ? 0.92 : 0.88) + (title ? 0.04 : 0),
      ruleId: "chapter",
    });
  }

  const v = line.match(VOLUME_HEADING_RE);
  if (v) {
    const title = v[2]?.trim() || null;
    candidates.push({
      unit: "卷",
      kind: "part",
      title,
      number: parseChineseNumber(v[1]),
      confidence: title ? 0.9 : 0.82,
      ruleId: "volume",
    });
  }

  const en = line.match(CHAPTER_HEADING_EN_RE);
  if (en) {
    const number = Number(en[1]);
    const title = en[2]?.trim() || null;
    candidates.push({
      unit: "chapter",
      kind: "chapter",
      title: title || `Chapter ${number}`,
      number,
      confidence: title ? 0.88 : 0.8,
      ruleId: "english",
    });
  }

  const chap = line.match(CHAP_MARKER_RE);
  if (chap) {
    const number = Number(chap[1]);
    const title = chap[2]?.trim() || null;
    candidates.push({
      unit: "章",
      kind: "chapter",
      title,
      number,
      confidence: title ? 0.9 : 0.8,
      ruleId: "chap_marker",
    });
  }

  const s = line.match(SPECIAL_HEADING_RE);
  if (s) {
    const specialUnit = s[1];
    const title = s[2]?.trim() || null;
    candidates.push({
      unit: specialUnit,
      kind: "chapter",
      title,
      number: null,
      confidence: title ? 0.84 : 0.78,
      ruleId: "special",
    });
  }

  return candidates;
}

function pickBestHeading(candidates: Heading[]): Heading | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));
}

/** 规则融合：候选按置信度排序，结合上下文护栏做最终裁决 */
export function detectHeading(line: string, context: HeadingContext = {}): Heading | null {
  const best = pickBestHeading(buildHeadingCandidates(line));
  if (!best) return null;

  let confidence = best.confidence;
  const prev = context.previousLine?.trimEnd() ?? "";
  // 上一行以冒号/逗号结尾 → 几乎可以确定当前行是正文承接，而非新章标题
  const prevContinues = /[：:，,、；;]$/.test(prev);

  if (prev && !context.previousIsHeading && !isSentenceEnd(prev)) {
    // 硬换行排版很常见：上一行没句号不等于误判。
    // 只有“他说：/A，”这类明确的正文承接才重罚；普通断行只轻微降分。
    confidence -= prevContinues ? 0.4 : 0.06;
  }
  // 序号连续（第2章接在第1章后）→ 强证据，抵消上一章的弱断句；
  // 但上一行明确是“他说：/A，”这类正文承接时不适用。
  const previousNumber = context.previousChapterNumber ?? null;
  if (best.number !== null && previousNumber !== null && best.number === previousNumber + 1 && !prevContinues) {
    confidence += 0.4;
  }

  confidence = Math.max(0, Math.min(1, confidence));
  if (confidence < 0.55) return null;
  return { ...best, confidence };
}

/** 兼容旧签名：不带上下文解析一行是否像标题 */
export function parseHeading(line: string): Heading | null {
  return detectHeading(line, {});
}

/** 连续 N 行都是标题候选且中间没有正文 → 判定为目录（TOC）整块跳过 */
const TOC_RUN_MIN = 4;

/**
 * TOC 识别：标题候选连续成段即为目录。
 * 目录是递增序号；当序号突然回落到更小值（如 第五章 → 第一章），
 * 说明目录已结束、正文真实章节开始，旧 run 到此为止。
 */
function findTocIndexes(candidatesByLine: Heading[][]): Set<number> {
  const indexes = new Set<number>();
  let runStart = -1;
  let runLastNumber: number | null = null;

  const closeRun = (end: number) => {
    if (runStart === -1) return;
    if (end - runStart >= TOC_RUN_MIN) {
      for (let k = runStart; k < end; k++) indexes.add(k);
    }
    runStart = -1;
    runLastNumber = null;
  };

  for (let i = 0; i <= candidatesByLine.length; i++) {
    const best = i < candidatesByLine.length ? pickBestHeading(candidatesByLine[i]) : null;
    if (!best) {
      closeRun(i);
      continue;
    }

    if (runStart === -1) {
      runStart = i;
      runLastNumber = best.number;
      continue;
    }

    // 序号回落 → 目录结束、正文开始（真实章节重新从第 1 章起）
    if (best.number !== null && runLastNumber !== null && best.number < runLastNumber) {
      closeRun(i);
      runStart = i;
      runLastNumber = best.number;
      continue;
    }

    // 目录里的“序章/终章”通常带标题；正文里的裸“序章/终章”没有标题 → 目录结束
    if (best.number === null && best.title === null && runLastNumber !== null) {
      closeRun(i);
      runStart = i;
      runLastNumber = null;
      continue;
    }

    if (best.number !== null) runLastNumber = best.number;
  }
  return indexes;
}

function makeChapter(
  idx: number,
  kind: ChapterKind,
  title: string | null,
  rawLines: string[],
  cleanLines: string[],
  parseMeta: Record<string, unknown>,
): CleanedChapter {
  const cleanedText = cleanLines.join("\n\n");
  return {
    idx,
    title,
    kind,
    rawText: rawLines.join("\n"),
    cleanedText,
    charCount: cleanedText.replace(/\s/g, "").length,
    parseMeta,
  };
}

/** 按约 5000 字（句子边界优先）兜底切段 */
function fallbackSegments(lines: string[], warnings: string[]): CleanedChapter[] {
  warnings.push("未识别到章节标题，已按约 5000 字/段切分");
  const chapters: CleanedChapter[] = [];
  let idx = 1;
  let buffer: string[] = [];
  let bufferChars = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    chapters.push(
      makeChapter(idx, "segment", null, buffer, reflowParagraphs(buffer), {
        splitBy: "fallback_5000",
      }),
    );
    idx += 1;
    buffer = [];
    bufferChars = 0;
  };

  for (const line of lines) {
    buffer.push(line);
    bufferChars += line.replace(/\s/g, "").length;
    // 优先在句子结束处切，避免把一句话切成两章
    if (bufferChars >= 5000 && isSentenceEnd(line)) flush();
  }
  flush();
  return chapters;
}

/** 清洗 + 切章。输入为已解码的文本。 */
export function cleanAndSplit(text: string): CleanResult {
  const warnings: string[] = [];
  const { lines, removedLines, dedupedLines, tailRemoved } = normalizeLinesDetailed(text);
  if (lines.length === 0) {
    return {
      encoding: "text-input",
      chapters: [],
      totalChars: 0,
      warnings: ["文件为空"],
      report: { removedLines, dedupedLines, tailRemoved, mergedLineBreaks: 0, tocLinesSkipped: 0 },
    };
  }

  interface Draft {
    heading: Heading | null;
    rawLines: string[];
    cleanLines: string[];
    parseMeta: Record<string, unknown>;
  }

  // 先对所有行做一次规则预筛：用于目录识别与标题上下文判断
  const headingCandidates = lines.map((line) => buildHeadingCandidates(line));
  const tocIndexes = findTocIndexes(headingCandidates);

  const drafts: Draft[] = [{ heading: null, rawLines: [], cleanLines: [], parseMeta: {} }];
  let sawHeading = false;
  let bodyLineCount = 0;
  let tocLinesSkipped = 0;
  let previousChapterNumber: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 目录（连续 ≥4 行标题、无正文穿插）整块跳过
    if (tocIndexes.has(i)) {
      tocLinesSkipped += 1;
      continue;
    }

    const heading = detectHeading(line, {
      previousLine: i > 0 ? lines[i - 1] : undefined,
      previousIsHeading: i > 0 && headingCandidates[i - 1].length > 0,
      previousChapterNumber,
      isFirstHeading: !sawHeading,
    });

    if (heading) {
      sawHeading = true;
      if (heading.number !== null) previousChapterNumber = heading.number;
      // 标题独占一行时，把紧随其后的 1~2 个短行并入标题（常见“第一章 / 雨夜”分行排版）
      if (!heading.title) {
        const titleParts: string[] = [];
        let j = i + 1;
        while (j < lines.length && titleParts.length < 2) {
          const candidate = lines[j];
          if (
            !candidate ||
            tocIndexes.has(j) ||
            headingCandidates[j].length > 0 ||
            candidate.length > 40 ||
            isSentenceEnd(candidate)
          ) {
            break;
          }
          titleParts.push(candidate);
          j += 1;
        }
        if (titleParts.length > 0) {
          heading.title = titleParts.join(" ");
          i = j - 1; // 跳过标题行
        }
      }
      // 裸“序章/终章”没有后续标题行时，回退显示为单元名
      if (!heading.title && heading.ruleId === "special") {
        heading.title = heading.unit;
      }
      drafts.push({ heading, rawLines: [], cleanLines: [], parseMeta: {} });
      continue;
    }

    const current = drafts[drafts.length - 1];
    current.rawLines.push(line);
    current.cleanLines.push(line);
    bodyLineCount += 1;
  }

  // 第一个 heading 之前的内容作为前言；若全书只有一个空前言则丢弃
  const chapters: CleanedChapter[] = [];
  let idx = 1;
  /** 卷/部/集标题后通常没有正文，作为结构标记并入下一章 parse_meta */
  let pendingVolume: { unit: string; title: string | null } | null = null;

  drafts.forEach((draft, i) => {
    if (i === 0 && !draft.heading) {
      // 只有在“有章节标题”时，首个标题之前的内容才是前言；
      // 全书无标题时交给 fallbackSegments 兜底切段。
      if (sawHeading && draft.cleanLines.length > 0) {
        chapters.push(
          makeChapter(0, "front", "前言", draft.rawLines, reflowParagraphs(draft.cleanLines), {
            matchedHeading: false,
          }),
        );
      }
      return;
    }

    if (!draft.heading) return;

    // 空正文的卷/部/集标题 → 作为后续章节的卷结构标记，不单独占章号
    if (draft.heading.kind === "part" && draft.cleanLines.length === 0) {
      pendingVolume = { unit: draft.heading.unit, title: draft.heading.title };
      return;
    }

    // 空正文的普通标题（如正文里的独立“Chap.1”标记行）→ 不占章号，直接跳过
    if (draft.cleanLines.length === 0) return;

    const kind = draft.heading.kind;
    const headingUnit = draft.heading.unit;
    const title = draft.heading.title;
    const parseMeta: Record<string, unknown> = {
      matchedHeading: true,
      unit: headingUnit,
      ruleId: draft.heading.ruleId,
      confidence: draft.heading.confidence,
    };
    if (draft.heading.number !== null) {
      parseMeta.number = draft.heading.number;
    }
    if (pendingVolume) {
      parseMeta.volume = { unit: pendingVolume.unit, title: pendingVolume.title };
      // 只并入下一章，避免多章重复携带
      pendingVolume = null;
    }
    chapters.push(
      makeChapter(idx, kind, title, draft.rawLines, reflowParagraphs(draft.cleanLines), parseMeta),
    );
    idx += 1;
  });

  const finalChapters = chapters.length > 0 ? chapters : fallbackSegments(lines, warnings);

  if (tocLinesSkipped > 0) {
    warnings.push(`检测到目录行 ${tocLinesSkipped} 行，已跳过（正文从实际章节开始）`);
  }

  // 质量警告（只提示，不改变结果）
  const headingChapters = finalChapters.filter((c) => c.kind === "chapter");
  for (const ch of headingChapters) {
    if (ch.charCount < 100) {
      warnings.push(`第 ${ch.idx} 章字数过少（${ch.charCount} 字），可能是标题误识别`);
    }
  }
  if (finalChapters.length > 500) {
    warnings.push(`章节数 ${finalChapters.length} 超过 500，建议检查切章规则`);
  }

  // 章节序号连续性检查（规则融合的第二道防线：提示人工复核，不自动改切分结果）
  const numberedChapters = headingChapters.filter(
    (ch) => typeof ch.parseMeta.number === "number",
  ) as Array<CleanedChapter & { parseMeta: { number: number; unit?: string } }>;
  let previousNumber: number | null = null;
  let previousUnit: string | null = null;
  const numberSeen = new Map<string, number>();
  for (const ch of numberedChapters) {
    const unit = typeof ch.parseMeta.unit === "string" ? ch.parseMeta.unit : "";
    const number = ch.parseMeta.number;
    if (unit !== previousUnit) {
      previousNumber = number;
      previousUnit = unit;
    } else if (previousNumber !== null && number !== previousNumber + 1) {
      warnings.push(
        `章节序号从 ${previousNumber} 跳到 ${number}（第 ${ch.idx} 章），可能缺章或切分遗漏`,
      );
      previousNumber = number;
    } else {
      previousNumber = number;
    }
    const key = `${unit}:${number}`;
    numberSeen.set(key, (numberSeen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of numberSeen) {
    if (count > 1) {
      const [unit, number] = key.split(":");
      warnings.push(`序号 ${number}（${unit}）出现 ${count} 次，可能有正文被误判为标题，请人工复核`);
    }
  }

  const paragraphCount = finalChapters.reduce(
    (sum, ch) => sum + ch.cleanedText.split("\n\n").length,
    0,
  );
  const mergedLineBreaks = Math.max(0, bodyLineCount - paragraphCount);

  const totalChars = finalChapters.reduce((sum, ch) => sum + ch.charCount, 0);
  return {
    encoding: "text-input",
    chapters: finalChapters,
    totalChars,
    warnings,
    report: { removedLines, dedupedLines, tailRemoved, mergedLineBreaks, tocLinesSkipped },
  };
}

/** 完整入口：字节 → 清洗切章结果 */
export function cleanBytes(buf: Uint8Array): CleanResult {
  const { text, encoding } = detectAndDecode(buf);
  const result = cleanAndSplit(text);
  return { ...result, encoding };
}
