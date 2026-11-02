export function printConversionDiagnostic(event) {
  if (event.kind === 'ruby-annotation-count') {
    const hint = event.count === 0 ? '；请检查匹配文本' : '';
    console.log(`手工注音规则 ${event.ruleIndex}：${event.count} 次${hint}`);
    return;
  }
  const position = event.paragraphIndex == null ? `目录项 ${event.tocEntryIndex ?? '?'}` : `段落 ${event.paragraphIndex}`;
  const reading = event.kind === 'rt' ? `，ruby ${event.rubyIndex}，rt ${event.rtIndex}` : '';
  console.log(`跳过 ${event.ruleId}：卷 ${event.volume}，${event.source}，${position}，区间 [${event.start}, ${event.end})${reading}`);
}
