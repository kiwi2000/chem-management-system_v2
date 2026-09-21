"""
題字（上の帯の「ケミカルコンプライアンス支援システム」）用の明朝フォントを作る。

Noto Serif JP（SIL OFL 1.1）の可変フォントから **太さ 600（SemiBold）で固定した実体を切り出し、
題字に使う文字だけ**に絞って woff2 にする。全員の PC で同じ見た目にするためで、
外部からフォントを取ってくるのではなく、アプリが自分で配る（通信ゼロの方針はそのまま）。

  PYTHONIOENCODING=utf-8 python scripts/build-title-font.py

- 元の書体: C:\\Windows\\Fonts\\NotoSerifJP-VF.ttf（この PC に入れてあるもの。無ければ --src で指定）
- 出力: apps/web/public/fonts/title-serif.woff2（数 KB）
- 文字: ja.ts / en.ts の appName の文字 ＋ ASCII の英数記号。題字の文言を変えたら流し直す
- ライセンス文は apps/web/public/fonts/OFL-NotoSerifJP.txt に置いてある（同梱の条件）
"""

import argparse
import io
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "fonts" / "title-serif.woff2"
DEFAULT_SRC = Path(r"C:\Windows\Fonts\NotoSerifJP-VF.ttf")


def app_names() -> str:
    """i18n の appName を両方読む。正規表現で十分（1 行の文字列）"""
    text = ""
    for name in ("ja.ts", "en.ts"):
        src = io.open(ROOT / "packages" / "shared" / "src" / "i18n" / name, encoding="utf-8").read()
        m = re.search(r'appName:\s*"([^"]+)"', src)
        if not m:
            sys.exit(f"{name} に appName が無い")
        text += m.group(1)
    return text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--weight", type=int, default=600)
    args = ap.parse_args()
    if not args.src.exists():
        sys.exit(f"元の書体が無い: {args.src}")

    chars = set(app_names()) | {chr(c) for c in range(0x20, 0x7F)}
    font = TTFont(args.src)
    # 可変フォントを太さで固定する（ブラウザに擬似太字を作らせない）
    font = instancer.instantiateVariableFont(font, {"wght": args.weight})

    opts = subset.Options()
    opts.flavor = "woff2"
    # 題字を 1 行出すだけなので、合字などの字形機能とヒント情報は落とす（103 KB → 19 KB）
    opts.layout_features = []
    opts.hinting = False
    opts.name_IDs = ["*"]  # ライセンス（name 13/14）を残す
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(sorted(chars)))
    sub.subset(font)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT)
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes, {len(chars)} 文字, wght {args.weight}")


if __name__ == "__main__":
    main()
