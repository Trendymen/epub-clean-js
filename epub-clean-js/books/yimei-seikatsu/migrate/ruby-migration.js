function uniqueIndex(items, value) {
  const matches = items.flatMap((item, index) => item === value ? [index] : []);
  return matches.length === 1 ? matches[0] : -1;
}

export function planRubyMigration({ chapter, sourceParagraphs, rubies, targetParagraphs, rules = [] }) {
  const records = rubies.map((ruby, index) => ({
    id: `${chapter}/ruby${String(index + 1).padStart(3, '0')}`,
    chapter,
    source: { ...ruby, paragraph: sourceParagraphs[ruby.paraIndex] },
    status: 'unresolved', reason: ruby.issue || 'unmapped-source', target: null,
  }));
  const annotations = [];
  const diagnostics = [];
  const claimed = new Set();
  for (const rule of rules) {
    const matches = rule.sources.map(selector => {
      const paraIndex = uniqueIndex(sourceParagraphs, selector.anchor);
      return records.filter(record => paraIndex >= 0 && record.source.paraIndex === paraIndex &&
        record.source.base === selector.base && record.source.reading === selector.reading && !record.source.issue);
    });
    const selected = [...new Set(matches.flat())];
    let reason = null;
    if (matches.some(match => match.length !== 1) || selected.length !== rule.sources.length) reason = 'source-anchor-or-signature-not-unique';
    if (selected.some(record => claimed.has(record.id))) reason = 'source-already-claimed';
    if (reason) {
      diagnostics.push({ chapter, rule: rule.id, reason });
      continue;
    }
    for (const record of selected) { claimed.add(record.id); record.rule = rule.id; }
    if (!rule.target) reason = rule.reason || 'no-safe-target-base';
    let annotation;
    if (!reason) {
      const paraIndex = uniqueIndex(targetParagraphs, rule.target.anchor);
      const text = rule.target.text;
      const paragraph = targetParagraphs[paraIndex];
      const start = paragraph?.indexOf(text) ?? -1;
      if (paraIndex < 0) reason = 'target-anchor-not-unique';
      else if (!text || start < 0 || paragraph.indexOf(text, start + 1) !== -1) reason = 'target-text-not-unique';
      else {
        annotation = {
          id: `${chapter}/${rule.id}`, paraIndex, start, end: start + text.length,
          base: rule.target.base || text,
          reading: (rule.target.readingFrom === 'base' ? selected.map(r => r.source.base) : [...new Set(selected.map(r => r.source.reading))]).join('／') + (rule.target.readingSuffix || ''),
        };
        if (annotations.some(other => other.paraIndex === paraIndex && other.start < annotation.end && annotation.start < other.end)) reason = 'overlapping-target';
      }
    }
    for (const record of selected) {
      record.reason = reason || (selected.length > 1 ? 'merged-sources' : null);
      record.status = reason ? 'unresolved' : selected.length > 1 ? 'merged' : 'applied';
      record.target = annotation ? { ...annotation, paragraph: rule.target.anchor } : null;
    }
    if (!reason) annotations.push(annotation);
  }
  return { annotations, records, diagnostics };
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 先在纯文本坐标中合并插入项，避免 ruby 标签改变脚注位置。
export function renderAnnotatedParagraph(text, annotations = [], footnotes = [], supers = []) {
  const rejected = [];
  const reasons = {};
  const native = annotations.filter(annotation => annotation.native);
  for (const sup of supers) {
    if (footnotes.some(note => note.offset > sup.start && note.offset < sup.end) ||
        native.some(ruby => ruby.start < sup.end && sup.start < ruby.end)) {
      throw new Error(`${sup.location}: overlapping-native-sup`);
    }
  }
  const accepted = annotations.filter(annotation => {
    if (annotation.native && !annotation.html) throw new Error(`${annotation.location}: missing-native-ruby-markup`);
    const crossing = footnotes.some(note => note.offset > annotation.start && note.offset < annotation.end);
    if (crossing && annotation.native) throw new Error(`${annotation.location}: footnote-inside-native-ruby`);
    const overlap = !annotation.native && native.some(other => other.start < annotation.end && annotation.start < other.end);
    const supOverlap = !annotation.native && supers.some(sup => sup.start < annotation.end && annotation.start < sup.end);
    if (crossing || overlap || supOverlap) {
      rejected.push(annotation.id);
      reasons[annotation.id] = overlap ? 'native-ruby-overlap' : supOverlap ? 'native-sup-overlap' : 'footnote-inside-ruby-range';
    }
    return !crossing && !overlap && !supOverlap;
  });
  const edits = [
    ...accepted.map(annotation => ({ start: annotation.start, end: annotation.end,
      html: annotation.native ? annotation.html : `<ruby>${escapeXml(annotation.base)}<rt>${escapeXml(annotation.reading)}</rt></ruby>` })),
    ...supers.map(sup => ({ start: sup.start, end: sup.end, html: sup.html })),
    ...footnotes.map(note => ({ start: note.offset, end: note.offset, html: note.html })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  let html = '';
  let cursor = 0;
  for (const edit of edits) {
    html += escapeXml(text.slice(cursor, edit.start)) + edit.html;
    cursor = edit.end;
  }
  return { html: html + escapeXml(text.slice(cursor)), rejected, reasons };
}

export function nativeSupAnnotations(supers, location) {
  return supers.map((sup, index) => ({
    paraIndex: sup.paraIndex, start: sup.start, end: sup.start + sup.text.length, html: sup.html,
    location: `${location}:p${sup.documentParaIndex + 1}:sup${index + 1}`,
  }));
}

export function nativeRubyAnnotations(rubies, location) {
  return rubies.map((ruby, index) => {
    if (!ruby.html) throw new Error(`${location}:p${ruby.documentParaIndex + 1}:ruby${index + 1}: missing-native-ruby-markup`);
    return {
    id: `${location}/native${index + 1}`, native: true, paraIndex: ruby.paraIndex,
    start: ruby.start, end: ruby.start + ruby.base.length, base: ruby.base, reading: ruby.reading, html: ruby.html,
    location: `${location}:p${ruby.documentParaIndex + 1}:ruby${index + 1}`,
    };
  });
}
