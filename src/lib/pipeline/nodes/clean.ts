/**
 * B10 · clean.split —— 文本清洗与章节切分（确定性为主）
 *
 * 职责：
 * 1. 编码探测（UTF-8 BOM / UTF-16 BOM / UTF-8 / GB18030）
 * 2. 去除常见盗版站水印、广告行、重复行
 * 3. 段落规范化
 * 4. 章节标题识别 + 切分；无标题时按 5000 字兜底切段
 *
 * 注意：本模块是纯函数，不访问 DB/R2，方便单测与命令行复用。
 */

export type ChapterKind = "chapter" | "part" | "front" | "segment";

export interface CleanedChapter {
  /** 章序号：前言=0，正文章从 1 开始 */
  idx: number;
  title: string | null;
  kind: ChapterKind;
  /** 该章对应的原文（清洗前，用于留证） */
  rawText: string;
  /** 清洗后的正文（段落间 \n\n） */
  cleanedText: string;
  charCount: number;
  parseMeta: Record<string, unknown>;
}

export interface CleanResult {
  encoding: string;
  chapters: CleanedChapter[];
  totalChars: number;
  warnings: string[];
}

const BOMS: Array<{ bytes: number[]; encoding: string }> = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" },
];

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
  /^[=*_\-~—]{4,}$/,
];

/** 章节标题：第X章/回/卷/部/节，X 支持中文数字与阿拉伯数字 */
const CHAPTER_HEADING_RE =
  /^[\s　]*第[\s]*[0-9零〇一二三四五六七八九十百千万两]{1,12}[\s]*([章回节]|[卷部集])[\s　]*([^\n]{0,80})?$/u;

/** 特殊章节标题：序章/楔子/引子/尾声/终章/后记/番外 */
const SPECIAL_HEADING_RE =
  /^[\s　]*(序章|序言|楔子|引子|尾声|终章|后记|番外)[\s　]*([^\n]{0,80})?$/u;

const NON_TEXT_LINE_RE = /^[\s　.,，。、；;：:!！?？·…—\-"'“”‘’()（）\[\]【】<>《》*~=]+$/;

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

/** 探测编码并解码为 UTF-16 JS 字符串 */
export function detectAndDecode(buf: Uint8Array): { text: string; encoding: string } {
  for (const bom of BOMS) {
    if (isBom(buf, bom.bytes)) {
      const body = buf.subarray(bom.bytes.length);
      return { text: new TextDecoder(bom.encoding).decode(body), encoding: bom.encoding };
    }
  }

  const candidates: Array<{ encoding: string; text: string; errors: number }> = [];
  for (const encoding of ["utf-8", "gb18030", "big5"]) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(buf);
      candidates.push({ encoding, text, errors: 0 });
    } catch {
      const text = new TextDecoder(encoding, { fatal: false }).decode(buf);
      candidates.push({ encoding, text, errors: countReplacementChars(text) });
    }
  }

  candidates.sort((a, b) => a.errors - b.errors);
  const best = candidates[0];
  return { text: best.text, encoding: best.encoding };
}

/** 去除 BOM、统一换行、按行清洗，返回非空行数组 */
export function normalizeLines(text: string): string[] {
  const withoutBom = text.replace(/^\uFEFF/, "");
  const normalized = withoutBom.replace(/\r\n?|\r/g, "\n");

  const lines = normalized.split("\n");
  const result: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (NON_TEXT_LINE_RE.test(line)) continue;
    if (WATERMARK_PATTERNS.some((re) => re.test(line))) continue;

    // 相邻重复行（盗版站“防屏蔽填充”）折叠为一行
    if (result[result.length - 1] === line) continue;

    result.push(line);
  }
  return result;
}

interface Heading {
  title: string | null;
  kind: Exclude<ChapterKind, "front">;
  unit: string;
}

function parseHeading(line: string): Heading | null {
  const m = line.match(CHAPTER_HEADING_RE);
  if (m) {
    const unit = m[1];
    const rest = m[2]?.trim() || "";
    return {
      unit,
      kind: unit === "章" || unit === "回" || unit === "节" ? "chapter" : "part",
      title: rest || null,
    };
  }
  const s = line.match(SPECIAL_HEADING_RE);
  if (s) {
    return {
      unit: s[1],
      kind: "chapter",
      title: s[2]?.trim() || s[1],
    };
  }
  return null;
}

function toParagraphs(lines: string[]): string {
  return lines.join("\n\n");
}

function makeChapter(
  idx: number,
  kind: ChapterKind,
  title: string | null,
  rawLines: string[],
  cleanLines: string[],
  parseMeta: Record<string, unknown>,
): CleanedChapter {
  const cleanedText = toParagraphs(cleanLines);
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

/** 按 5000 字（段落边界）兜底切段 */
function fallbackSegments(lines: string[], warnings: string[]): CleanedChapter[] {
  warnings.push("未识别到章节标题，已按约 5000 字/段切分");
  const chapters: CleanedChapter[] = [];
  let idx = 1;
  let buffer: string[] = [];
  let bufferChars = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    chapters.push(makeChapter(idx, "segment", null, buffer, buffer, { splitBy: "fallback_5000" }));
    idx += 1;
    buffer = [];
    bufferChars = 0;
  };

  for (const line of lines) {
    buffer.push(line);
    bufferChars += line.replace(/\s/g, "").length;
    if (bufferChars >= 5000) flush();
  }
  flush();
  return chapters;
}

/** 清洗 + 切章。输入为已解码的文本。 */
export function cleanAndSplit(text: string): CleanResult {
  const warnings: string[] = [];
  const lines = normalizeLines(text);
  if (lines.length === 0) {
    return { encoding: "unknown", chapters: [], totalChars: 0, warnings: ["文件为空"] };
  }

  interface Draft {
    heading: Heading | null;
    rawLines: string[];
    cleanLines: string[];
    parseMeta: Record<string, unknown>;
  }

  const drafts: Draft[] = [{ heading: null, rawLines: [], cleanLines: [], parseMeta: {} }];
  let sawHeading = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = parseHeading(line);
    if (heading) {
      sawHeading = true;
      // 标题独占一行且后面紧跟短行时，把短行并入标题
      if (!heading.title) {
        const next = lines[i + 1];
        if (next && next.length <= 30 && !next.endsWith("。") && !parseHeading(next)) {
          heading.title = next;
          i += 1; // 跳过标题行
        }
      }
      drafts.push({ heading, rawLines: [], cleanLines: [], parseMeta: {} });
      continue;
    }

    const current = drafts[drafts.length - 1];
    current.rawLines.push(line);
    current.cleanLines.push(line);
  }

  // 第一个 heading 之前的内容作为前言；若全书只有一个空前言则丢弃
  const chapters: CleanedChapter[] = [];
  let idx = 1;

  drafts.forEach((draft, i) => {
    if (draft.cleanLines.length === 0) return;

    if (i === 0 && !draft.heading) {
      // 只有在“有章节标题”时，首个标题之前的内容才是前言；
      // 全书无标题时交给 fallbackSegments 兜底切段。
      if (sawHeading) {
        chapters.push(makeChapter(0, "front", "前言", draft.rawLines, draft.cleanLines, {}));
      }
      return;
    }

    const kind = draft.heading?.kind ?? "chapter";
    const headingUnit = draft.heading?.unit ?? "";
    const title = draft.heading?.title ?? null;
    const parseMeta = {
      matchedHeading: Boolean(draft.heading),
      unit: headingUnit || undefined,
    };
    chapters.push(makeChapter(idx, kind, title, draft.rawLines, draft.cleanLines, parseMeta));
    idx += 1;
  });

  const finalChapters = chapters.length > 0 ? chapters : fallbackSegments(lines, warnings);

  // 超短/超长章节提示
  for (const ch of finalChapters) {
    if (ch.kind === "chapter" && ch.charCount < 100) {
      warnings.push(`第 ${ch.idx} 章字数过少（${ch.charCount} 字），可能是标题误识别`);
    }
  }

  const totalChars = finalChapters.reduce((sum, ch) => sum + ch.charCount, 0);
  return { encoding: "text-input", chapters: finalChapters, totalChars, warnings };
}

/** 完整入口：字节 → 清洗切章结果 */
export function cleanBytes(buf: Uint8Array): CleanResult {
  const { text, encoding } = detectAndDecode(buf);
  const result = cleanAndSplit(text);
  return { ...result, encoding };
}
