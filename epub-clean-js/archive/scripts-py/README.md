# scripts-py 归档说明

义妹生活 09 卷迁移管线的 Python 原始实现，已被 Node ESM 版本完整替代。

- 归档日期：2026-05-22T11:14:59Z
- 等价 Node 实现：`../../books/yimei-seikatsu/migrate/`
- 设计文档：`../../../../docs/superpowers/specs/2026-05-22-py-to-node-migration-design.md`
- 实施计划：`../../../../docs/superpowers/plans/2026-05-22-py-to-node-migration.md`
- 验收记录：`../../../../docs/superpowers/phase1-acceptance.md`、`phase2-acceptance.md`、`phase3-acceptance.md`

## 如需运行（仅历史参考）

```bash
cd scripts-py
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python migrate_epub.py --help
```

> ⚠ 仅作历史参考，已不再维护。Bug 修复请改 Node 版。
> 当前正式产物 `[三河ごーすと].义妹生活.09.[台简].epub` 由 Node 版生成。
