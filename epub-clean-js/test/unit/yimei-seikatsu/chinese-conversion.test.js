import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as OpenCC from 'opencc-js';

import {
  applyWordingRules,
  createBaseRubyConverter,
  simplifyBase,
  simplifyBaseWithRuby,
  simplifyText,
  validateWording,
} from '../../../books/yimei-seikatsu/chinese-conversion.js';

test('基础转换修正旧词库字形并保留台版措辞', () => {
  assert.equal(
    simplifyBase('抬頭、覆上保鮮膜、拚命、床舖、乾隆、乾淨、著作、看著、天﨑滉平、妳、網路、訊息、便當∼'),
    '抬头、覆上保鲜膜、拼命、床铺、乾隆、干净、著作、看着、天﨑滉平、妳、网路、讯息、便当～',
  );
  assert.equal(simplifyText('智慧型手機和網路上'), '智慧型手机和网路上');
  assert.equal(simplifyText('智慧型手機和網路上', { wording: 'mainland' }), '智能手机和网络上');
});

test('用词模式只接受明确支持的值', () => {
  assert.equal(validateWording(), 'taiwan');
  assert.equal(validateWording('mainland'), 'mainland');
  for (const value of ['', 'invalid', null]) assert.throws(() => validateWording(value), /wording/i);
});

test('可选词表只替换核对过的词组', () => {
  const text = '网路上、手机萤幕、智慧型手机；网路、萤幕、智慧型吐槽、讯息、资料、便当';
  assert.equal(applyWordingRules(text).text, text);
  assert.equal(
    applyWordingRules(text, { wording: 'mainland' }).text,
    '网络上、手机屏幕、智能手机；网路、萤幕、智慧型吐槽、讯息、资料、便当',
  );
  assert.equal(simplifyText('按照班級順序列出了很多工作', { wording: 'mainland' }), '按照班级顺序列出了很多工作');
  assert.equal(
    applyWordingRules('网路上手机萤幕智慧型手机智慧型手机', { wording: 'mainland' }).text,
    '网络上手机屏幕智能手机智能手机',
  );
});

test('变长词组更新后续注音位置', () => {
  const result = applyWordingRules('智慧型手机和浅村', {
    wording: 'mainland', ranges: [{ start: 6, end: 8 }],
  });
  assert.equal(result.text, '智能手机和浅村');
  assert.deepEqual(result.ranges, [{ start: 5, end: 7 }]);
  assert.deepEqual(result.skipped, []);
});

test('词组与注音相交时保留文本并返回基线区间', () => {
  const result = applyWordingRules('智慧型手机和浅村', {
    wording: 'mainland', ranges: [{ start: 0, end: 3 }],
  });
  assert.equal(result.text, '智慧型手机和浅村');
  assert.deepEqual(result.ranges, [{ start: 0, end: 3 }]);
  assert.deepEqual(result.skipped, [{ ruleId: 'smartphone', start: 0, end: 5 }]);
});

const context = { volume: '13', source: 'item/xhtml/p-002.xhtml', paragraphIndex: 1 };

function expectMappingError(action, reason) {
  assert.throws(action, (error) => {
    assert.match(error.message, /\(13:item\/xhtml\/p-002\.xhtml:1\)/);
    assert.match(error.message, reason);
    return true;
  });
}

test('基础转换保留跨词注音并按 UTF-16 宽度映射补充平面字', () => {
  const result = simplifyBaseWithRuby('乾隆、二噁英、著作', [
    { start: 1, end: 2, rt: '皇帝' },
    { start: 4, end: 5, rt: '恶' },
  ], context);
  assert.equal(result.text, '乾隆、二𫫇英、著作');
  assert.deepEqual(result.spans, [
    { start: 1, end: 2, base: '隆', rt: '皇帝' },
    { start: 4, end: 6, base: '𫫇', rt: '恶' },
  ]);
});

test('源文本中的补充平面字保留完整注音区间', () => {
  assert.deepEqual(simplifyBaseWithRuby('𫫇著作', [{ start: 0, end: 2, rt: '恶' }], context), {
    text: '𫫇著作', spans: [{ start: 0, end: 2, base: '𫫇', rt: '恶' }],
  });
});

test('表意文字描述序列与相邻注音按 OpenCC 的原始边界处理', () => {
  assert.deepEqual(simplifyBaseWithRuby('甲⿰門馬乙', [{ start: 0, end: 1, rt: '甲' }], context), {
    text: '甲⿰門馬乙', spans: [{ start: 0, end: 1, base: '甲', rt: '甲' }],
  });
});

test('无效 UTF-16 边界和孤立代理项不能用于注音映射', () => {
  expectMappingError(() => simplifyBaseWithRuby('甲𫫇乙', [{ start: 2, end: 3, rt: 'x' }], context), /invalid UTF-16 ruby boundary/);
  expectMappingError(() => simplifyBaseWithRuby('甲\ud800乙', [{ start: 0, end: 1, rt: 'x' }], context), /isolated surrogate/);
});

function syntheticConverter(...dictionaries) {
  const config = { normalizationChain: [], segmentation: [], conversionChain: dictionaries.map((dictionary) => [dictionary]) };
  const expectedDigest = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  const convert = OpenCC.ConverterFactory(...config.conversionChain);
  return createBaseRubyConverter({ config, convert, expectedDigest });
}

test('合成转换链的可靠注音位置可以正常映射', () => {
  assert.deepEqual(syntheticConverter('甲 乙')('甲', [{ start: 0, end: 1, rt: 'x' }], context), {
    text: '乙', spans: [{ start: 0, end: 1, base: '乙', rt: 'x' }],
  });
});

test('局部增减抵消时仍拒绝不可靠的注音映射', () => {
  expectMappingError(
    () => syntheticConverter('甲 甲甲|乙乙 乙')('甲乙乙', [{ start: 0, end: 1, rt: 'x' }], context),
    /dictionary changes code point count/,
  );
});

test('跨注音边界的等长重排不能被当作逐字对应', () => {
  expectMappingError(
    () => syntheticConverter('甲乙 乙甲')('甲乙', [{ start: 1, end: 2, rt: 'x' }], context),
    /dictionary match crosses a ruby boundary/,
  );
});

test('表意文字描述序列不能掩盖后续阶段的跨注音重排', () => {
  const convert = syntheticConverter('乙 丙', '⿰甲乙丙 ⿰甲丙乙|⿰甲丙丙 ⿰甲丙乙');
  expectMappingError(() => convert('⿰甲乙丙', [{ start: 2, end: 3, rt: 'x' }], context),
    /dictionary match crosses a ruby boundary/);
});

test('词典指纹不符时带位置报错', () => {
  const config = { normalizationChain: [], segmentation: [], conversionChain: [['甲 乙']] };
  const convert = createBaseRubyConverter({ config, convert: OpenCC.ConverterFactory(['甲 乙']), expectedDigest: 'incorrect' });
  expectMappingError(() => convert('甲', [{ start: 0, end: 1, rt: 'x' }], context), /unexpected OpenCC configuration/);
});

test('追踪结果与实际转换不符时带位置报错', () => {
  const config = { normalizationChain: [], segmentation: [], conversionChain: [['甲 乙']] };
  const expectedDigest = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  const convert = createBaseRubyConverter({ config, convert: () => '甲', expectedDigest });
  expectMappingError(() => convert('甲', [{ start: 0, end: 1, rt: 'x' }], context), /traced conversion differs/);
});

test('没有注音时允许基础转换改变码点数量', () => {
  assert.deepEqual(syntheticConverter('甲 甲甲')('甲', [], context), { text: '甲甲', spans: [] });
});
