// another days 日翻注释迁移到最终台简正文的固定定位表。
//
// 数据语义对齐 migrate/profile.footnoteOverrides：chapter key 使用最终产物的
// OEBPS/Text/chapterNNNN.xhtml 编号，afterParaIdx 是最终台简正文段落索引，
// anchor 是该段内的落点字符串，脚注标记插在 anchor 之后。
//
// 台版 Readmoo 源自带的内联「註：」由 lightnovel-html 渲染时自动转换为点击脚注；
// 这里不重复记录。日翻中与台版内联注重复的「大喜利」「Yuming」两条也不迁移。

export const ANOTHER_DAYS_FIXED_FOOTNOTES = {
  chapter0002: [
    {
      afterParaIdx: 1,
      anchor: '恋爱生活小说',
      body: '重视人物日常、心理活动与人际关系的剧情作品',
    },
    {
      afterParaIdx: 2,
      anchor: '私小说',
      body: '私小说一般指以作者真实私生活和内心为基础写成的小说',
    },
  ],
  chapter0005: [
    { afterParaIdx: 6, anchor: '水槽のブランコ', body: '水缸里的秋千' },
  ],
  chapter0006: [
    {
      afterParaIdx: 11,
      anchor: '出差版',
      body: '出张版，意思是番外特别篇，但不在本家的相关作品出现。网址就不放在这里了，大家可以去YouTube的「漫画エンジェルネコオカ」账号下自行搜索，视频全名是『【漫画】バイト先の先輩が俺にだけ優しい。大学のチャラ男には興味がない。【義妹生活】』，是一部有声漫画',
    },
  ],
  chapter0011: [
    {
      afterParaIdx: 87,
      anchor: '义妹开始写日记的理由',
      body: '视频小剧场的大致内容是，故事发生在当天和浅村父子见面之前，是放学前真绫和沙季的一段对话。写日记是真绫给沙季的建议。真绫先调侃了可能会出现的义兄妹恋爱桥段，然后假设对方可能是好人，也可能发生恋爱喜剧，或者对方可能是坏人，也就是令人讨厌的情况，并据此建议沙季准备一本日记，用来记录各种证据。最后沙季独白：「我现在还不知道这本日记会写下什么内容。如果它会充满悲伤的回忆，我可能会怨恨新的家人；为了消解负面情绪，我会对新家人不抱任何期待。如果能够记录下美好的回忆，也许未来的自己会笑得更好看」',
    },
  ],
  chapter0012: [
    {
      afterParaIdx: 1,
      anchor: '网路社群媒体世代',
      body: 'SNS世代指在社交网络高度普及的环境中成长、受其影响较大的一代',
    },
  ],
  chapter0013: [
    {
      afterParaIdx: 48,
      anchor: '夜校',
      body: '日文原文为定时制高校，指的是通常在傍晚到夜间开课，类似成人高中，换到国内也就是夜校',
    },
  ],
  chapter0014: [
    { afterParaIdx: 99, anchor: '原本的「与」', body: '这里的「と」是「和」的意思' },
    { afterParaIdx: 107, anchor: '一口气将它看完', body: '只能一周一集播放' },
  ],
  chapter0015: [
    {
      afterParaIdx: 22,
      anchor: '菲力普．马罗',
      body: '这里指的是作家雷蒙德•钱德勒创造的虚构人物，职业是私家侦探。当上私家侦探之前是洛杉矶地检处卫尔德检察官下面的一名调查员，后来因不服从命令而被解雇',
    },
    {
      afterParaIdx: 22,
      anchor: '最后一本长篇小说',
      body: '此处所指的长篇应为以下几本：《长眠不醒》《再见，宝贝》《高窗》《湖底女人》《小妹妹》《漫长的告别》《重播》，另有未完成遗作未找到中文译名，其改编的电影名为《豪门恩怨/幕后通缉令》',
    },
    {
      afterParaIdx: 61,
      anchor: '天花板上的污渍',
      body: '此为一个日本经典的逃避显示网络梗，后逐渐演变为一种对现实的逃避的表现手法，如《化物语》中也出现过阿良良木历数天花板霉斑的场景',
    },
    {
      afterParaIdx: 88,
      anchor: '本本搭档',
      body: '日文中双关「原本」之意，但我想玩这个二本学历梗',
    },
    {
      afterParaIdx: 89,
      anchor: '滚下坡道的是坂本同学',
      body: '坡道在日文中即为坂，是个类似于「高先生从高山上滚下来」的冷笑话',
    },
    {
      afterParaIdx: 108,
      anchor: '装得很老实',
      body: '这是日语中的一个常用惯用语，意思是假装老实，隐藏本性，装乖',
    },
    {
      afterParaIdx: 109,
      anchor: '捡回家',
      body: '为了便于理解这里做了一点本土化',
    },
    {
      afterParaIdx: 118,
      anchor: '憋不住还是不想憋',
      body: '还是有点含蓄的，大概意思是说喝醉了发生关系是说不清是巧合还是惯例的',
    },
    {
      afterParaIdx: 118,
      anchor: '根本没打算认真交往',
      body: '这个就很直白了，和「我就蹭蹭不进去」差不多一个意思',
    },
    {
      afterParaIdx: 133,
      anchor: '戴上面具隐藏本性',
      body: '这里的巨大意在表示她的伪装是全方位且根深蒂固的',
    },
    {
      afterParaIdx: 163,
      anchor: '虽然是狗',
      body: '指电影《妙犬神探》（又名《名侦探福尔摩斯》），由宫崎骏参与执导',
    },
    {
      afterParaIdx: 216,
      anchor: '导致伪装失败',
      body: '虽然之前就有所体现，但我认为这里才是本篇呈现方式具有较高文学性的开始',
    },
    {
      afterParaIdx: 239,
      anchor: '卡涅阿德斯船板',
      body: '卡涅阿德斯船板是古希腊学者卡涅阿德斯提出的伦理学思想实验，通过虚构场景探讨极端求生情境下的道德边界。该情景引发关于自卫行为是否构成谋杀的伦理争议，核心在于极端情境下求生权利与道德责任的平衡',
    },
    {
      afterParaIdx: 400,
      anchor: '心脏都快跳出来了',
      body: '故意压低嗓子吓人的',
    },
    {
      afterParaIdx: 505,
      anchor: '轻小说．ＭＦ文库Ｊ',
      body: '本系列的出版社',
    },
    {
      afterParaIdx: 572,
      anchor: '汤姆．索亚与哈克贝里．芬',
      body: '二者皆为美国文豪马克•吐温所作同名书籍主人公，是两个小顽童',
    },
    {
      afterParaIdx: 645,
      anchor: '一点也不适合',
      body: '这里是在吐槽一半露一半不露',
    },
    {
      afterParaIdx: 702,
      anchor: 'Manreistjanicht,umanzukommen,sondernumzureisen.',
      body: '非为译者不译，建议读者勿查，往后看就明白了',
    },
    {
      afterParaIdx: 737,
      anchor: 'ＭＣＵ',
      body: '漫威宇宙',
    },
    {
      afterParaIdx: 766,
      anchor: '玛波小姐',
      body: '简•马普尔，虚构侦探角色，1930年首次登场于小说《寓所谜案》',
    },
    {
      afterParaIdx: 767,
      anchor: 'EndlessNight',
      body: '本处及上段三本小说分别指的是《无人生还》《破镜谋杀案》《长夜》，译名以新星出版社『午夜文库』系列为准',
    },
    {
      afterParaIdx: 875,
      anchor: '狗狗的尾巴',
      body: '这里是冈本在用八公像打趣',
    },
    {
      afterParaIdx: 910,
      anchor: '浮石',
      body: '轻石是一种火山石，外表带有粗糙尖利但实际上是空心气泡质地，能在水上漂浮，这里是略带调侃地形容他过度装饰、品味夸张，实则轻浮',
    },
    {
      afterParaIdx: 933,
      anchor: '电话情杀案',
      body: '1954年由阿尔弗雷德•希区柯克执导的电影，该片根据弗雷德里克•诺特的舞台剧改编，该片以商人东尼为主角，揭露了他因发现妻子玛丽与侦探小说家马克的不正当关系，而精心策划了一场看似完美的电话谋杀计划，意图置玛丽于死地',
    },
    {
      afterParaIdx: 933,
      anchor: '乱世佳人',
      body: '又作『飘』由维克多•弗莱明执导，费雯•丽、克拉克•盖博主演的电影，改编自美国女作家玛格丽特•米切尔同名小说，讲述在南北战争爆发后，南方种植园主女儿斯嘉丽目睹家园被毁，在乱世中为生存与爱情坚韧辗转，最终悟得幸福的故事',
    },
    {
      afterParaIdx: 1007,
      anchor: '夏目漱石、芥川龙之介、太宰治、三岛由纪夫',
      body: '按顺序代表作分别为『我是猫』、『罗生门』、『人间失格』、『金阁寺』',
    },
    {
      afterParaIdx: 1034,
      anchor: '《尸变》',
      body: '是由山姆•雷米自编自导，讲述了五个年轻人周末驾车外出探险中无意引来了住在附近森林中的魔鬼，四人陆续被恶魔附体，只有一人与魔鬼血战到底的恐怖故事',
    },
    {
      afterParaIdx: 1034,
      anchor: '《死灵之舞》',
      body: '一部1965年的经典美国奇幻情色恐怖Z级邪典片，讲述了一对年轻情侣夜间驾车误入荒废墓地，遭遇了夜之帝王与黑暗女王，被绑在墓碑上被迫观看亡灵亡魂跳舞的超现实故事',
    },
    {
      afterParaIdx: 1282,
      anchor: '泷廉太郎的《花》',
      body: '本处采用微信公众号『金中诗词』译本',
    },
  ],
};

export function anotherDaysFixedFootnotesForChapter(volume, chapterId) {
  if (!['another-days', 'an'].includes(String(volume).toLowerCase())) return [];
  return ANOTHER_DAYS_FIXED_FOOTNOTES[chapterId] ?? [];
}
