import zipfile
from pathlib import Path


def pack_epub(src_dir: Path, out_path: Path) -> None:
    """打包目录为 EPUB。mimetype 必须最先写入且无压缩。"""
    src_dir = Path(src_dir)
    mimetype = src_dir / "mimetype"
    if not mimetype.exists():
        raise FileNotFoundError(f"mimetype not found in {src_dir}")

    with zipfile.ZipFile(out_path, "w") as zf:
        # mimetype 必须最先、STORED 无压缩
        zf.write(mimetype, "mimetype", compress_type=zipfile.ZIP_STORED)
        # 其他文件
        for path in sorted(src_dir.rglob("*")):
            if path.is_file() and path != mimetype:
                rel = path.relative_to(src_dir).as_posix()
                zf.write(path, rel, compress_type=zipfile.ZIP_DEFLATED)
