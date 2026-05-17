"""按4列横向布局解析《小学考纲词库706.pdf》为markdown表格。"""
import pdfplumber
import re

PDF = '小学考纲词库706.pdf'
OUT = '小学考纲词库706.md'

# 4列起始 x 坐标边界（来源于实测 x0：41/239/437/635）
COL_BOUNDS = [(40, 235), (235, 433), (433, 631), (631, 900)]


def parse_column_lines(words, x_lo, x_hi):
    """提取一列中的词条：返回 list[(序号:int, 单词:str, 释义:str)]。"""
    col_words = [w for w in words if w['x0'] >= x_lo and w['x0'] < x_hi]
    # 按行聚合（top 接近视为同一行）
    col_words.sort(key=lambda w: (round(w['top'], 0), w['x0']))
    rows = []
    cur_top = None
    cur_line = []
    for w in col_words:
        if cur_top is None or abs(w['top'] - cur_top) > 4:
            if cur_line:
                rows.append(cur_line)
            cur_line = [w]
            cur_top = w['top']
        else:
            cur_line.append(w)
    if cur_line:
        rows.append(cur_line)

    entries = []  # (序号, 单词tokens, 释义tokens)
    for line in rows:
        line.sort(key=lambda w: w['x0'])
        texts = [w['text'] for w in line]
        # 跳过表头
        if texts and texts[0] in ('序号',):
            continue
        # 第一个 token 应为序号（数字）。若非，是上一条的续行（中文释义换行）
        if texts and re.fullmatch(r'\d+', texts[0]):
            num = int(texts[0])
            rest = texts[1:]
            # 单词 = 直到出现中文字符的 token 之前
            word_toks = []
            mean_toks = []
            seen_cn = False
            for t in rest:
                if not seen_cn and re.search(r'[\u4e00-\u9fff]', t):
                    seen_cn = True
                if seen_cn:
                    mean_toks.append(t)
                else:
                    word_toks.append(t)
            entries.append([num, word_toks, mean_toks])
        else:
            # 续行 -> 追加到上一个条目的释义/单词
            if not entries:
                continue
            # 判断追加到单词还是释义
            if any(re.search(r'[\u4e00-\u9fff]', t) for t in texts):
                entries[-1][2].extend(texts)
            else:
                entries[-1][1].extend(texts)
    return entries


all_entries = {}
with pdfplumber.open(PDF) as pdf:
    for page in pdf.pages:
        words = page.extract_words(keep_blank_chars=False)
        for x_lo, x_hi in COL_BOUNDS:
            for num, wtoks, mtoks in parse_column_lines(words, x_lo, x_hi):
                word = ''.join(wtoks) if wtoks else ''
                # 单词内部的连字符可能因换行被拆开；这里直接拼接
                meaning = ''.join(mtoks)
                all_entries[num] = (word, meaning)

# 输出
lines = ['# 小学考纲词库 706', '', '| 序号 | 单词 | 释义 |', '|---:|---|---|']
for num in sorted(all_entries.keys()):
    w, m = all_entries[num]
    lines.append(f'| {num} | {w} | {m} |')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')

print(f'共 {len(all_entries)} 条 -> {OUT}')
# 简单完整性校验：序号是否连续
nums = sorted(all_entries.keys())
missing = [n for n in range(1, nums[-1] + 1) if n not in all_entries]
print('缺号:', missing[:20], '... total missing:', len(missing))
print('最大序号:', nums[-1])
