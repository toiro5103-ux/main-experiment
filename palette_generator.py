# -*- coding: utf-8 -*-
"""
色パレット生成スクリプト
=========================

CIELCh(ab) 空間で色相(h)ごとに明度(L*)を6段階変化させたパレットを作り、
sRGB(hex)に変換して palettes.json に出力する。

【彩度の扱い（重要）】
これまでの「高明度端で彩度を小さく、低明度端で大きくする線形補間」だと、
"明度"のつもりの操作変数に彩度の変化が混入してしまう。
このスクリプトでは、各色相について
  1. 各明度レベルで実現可能な最大彩度 C*_max(L) を sRGB色域内で二分探索
  2. 6レベル中の最小値 min(C*_max) を、その色相で全レベル共通の彩度として採用
することで、彩度を完全に固定した状態で明度だけを変化させる。
(色域の狭い明度レベルに合わせるので、他のレベルはやや彩度が抑えめの発色になるが、
 「明度以外は統制されている」ことの方が実験上は重要という判断)

【背景色】
実験刺激の集合(L*30〜90)に対して、
  - dark   : L*=10 （集合より暗い→明るい色ほどコントラストが強い）
  - neutral: L*=60 （集合の中央→コントラストがほぼ対称）
  - light  : L*=95 （集合より明るい→暗い色ほどコントラストが強い）
の3水準を候補として出力する。
"""

import json
import math

# ==============================================================================
# 設定
# ==============================================================================

# JIS安全色を基準にした色相角(度)。値はMTG資料のものを踏襲。
HUES = {
    "exp1_red":    40.0,
    "exp1_orange": 59.0,
    "exp1_yellow": 87.0,
    "exp1_green":  155.0,
    "exp1_blue":   250.0,
    "exp1_purple": 329.0,
}

L_LEVELS = [30, 40, 50, 60, 70, 80, 90]  # ★7段階（TARGET_COUNT=7に合わせて明度レベルも7段階に変更）

BACKGROUND_L_LEVELS = {
    "dark": 10.0,
    "neutral": 60.0,
    "light": 95.0,
}

CHROMA_SEARCH_MAX = 150.0   # 二分探索の上限（CIELABのC*として十分large）
CHROMA_SEARCH_TOL = 0.05    # 二分探索の収束許容誤差

# D65白色点 (2度視野)
XN, YN, ZN = 95.047, 100.0, 108.883


# ==============================================================================
# CIELab -> sRGB 変換
# ==============================================================================

def _finv(t):
    return t ** 3 if t ** 3 > 0.008856 else (t - 16.0 / 116.0) / 7.787


def lab_to_xyz(L, a, b):
    fy = (L + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - b / 200.0
    X = XN * _finv(fx)
    Y = YN * _finv(fy)
    Z = ZN * _finv(fz)
    return X, Y, Z


def _gamma_companding(c):
    if c <= 0.0031308:
        return 12.92 * c
    return 1.055 * (c ** (1.0 / 2.4)) - 0.055


def xyz_to_srgb_linear(X, Y, Z):
    X, Y, Z = X / 100.0, Y / 100.0, Z / 100.0
    r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z
    g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z
    b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z
    return r, g, b


def lch_to_srgb(L, C, h_deg, tol=1e-4):
    """CIELCh(ab) -> (R,G,B) in [0,1]。色域外ならNoneを返す。"""
    h_rad = math.radians(h_deg)
    a = C * math.cos(h_rad)
    b = C * math.sin(h_rad)
    X, Y, Z = lab_to_xyz(L, a, b)
    r, g, bch = xyz_to_srgb_linear(X, Y, Z)
    rgb_linear = (r, g, bch)
    if any(v < -tol or v > 1 + tol for v in rgb_linear):
        return None
    rgb = tuple(_gamma_companding(max(0.0, min(1.0, v))) for v in rgb_linear)
    return rgb


def rgb_to_hex(rgb):
    return "#{:02X}{:02X}{:02X}".format(
        *[max(0, min(255, round(v * 255))) for v in rgb]
    )


def find_max_chroma(L, h_deg):
    """指定L*,h において sRGB色域内に収まる最大のC*を二分探索で求める。"""
    lo, hi = 0.0, CHROMA_SEARCH_MAX
    # まずhiが色域外であることを確認（C*=0は必ず色域内=無彩色なので安全）
    while hi - lo > CHROMA_SEARCH_TOL:
        mid = (lo + hi) / 2.0
        if lch_to_srgb(L, mid, h_deg) is not None:
            lo = mid
        else:
            hi = mid
    return lo


# ==============================================================================
# パレット生成
# ==============================================================================

def build_hue_palette(hue_name, h_deg):
    # 1. 各明度レベルの最大彩度を求める
    max_chromas = {L: find_max_chroma(L, h_deg) for L in L_LEVELS}

    # 2. 全レベル共通で使える彩度 = 最小値を採用（彩度を完全に固定するため）
    fixed_c = min(max_chromas.values())

    palette = []
    for level, L in enumerate(L_LEVELS):
        rgb = lch_to_srgb(L, fixed_c, h_deg)
        if rgb is None:
            # 丸め誤差対策：わずかに彩度を下げて再試行
            rgb = lch_to_srgb(L, max(0.0, fixed_c - 0.5), h_deg)
        hex_code = rgb_to_hex(rgb)
        palette.append({
            "level": level,
            "L": L,
            "C": round(fixed_c, 2),
            "h": h_deg,
            "hex": hex_code,
        })

    return palette, fixed_c, max_chromas


def build_grayscale_palette():
    palette = []
    for level, L in enumerate(L_LEVELS):
        rgb = lch_to_srgb(L, 0.0, 0.0)
        palette.append({
            "level": level,
            "L": L,
            "C": 0.0,
            "h": None,
            "hex": rgb_to_hex(rgb),
        })
    return palette


def build_backgrounds():
    bg = {}
    for name, L in BACKGROUND_L_LEVELS.items():
        rgb = lch_to_srgb(L, 0.0, 0.0)
        bg[name] = {"L": L, "hex": rgb_to_hex(rgb)}
    return bg


def main():
    all_palettes = {}
    report_lines = []

    for hue_name, h_deg in HUES.items():
        palette, fixed_c, max_chromas = build_hue_palette(hue_name, h_deg)
        all_palettes[hue_name] = palette
        report_lines.append(
            f"{hue_name} (h={h_deg}): 採用彩度 C*={fixed_c:.1f} "
            f"(各レベルの最大彩度: "
            + ", ".join(f"L{L}={c:.1f}" for L, c in max_chromas.items())
            + ")"
        )

    all_palettes["exp1_gray"] = build_grayscale_palette()

    backgrounds = build_backgrounds()

    with open("palettes.json", "w", encoding="utf-8") as f:
        json.dump(all_palettes, f, ensure_ascii=False, indent=2)

    with open("backgrounds.json", "w", encoding="utf-8") as f:
        json.dump(backgrounds, f, ensure_ascii=False, indent=2)

    print("=== 彩度統制レポート ===")
    for line in report_lines:
        print(line)
    print()
    print("=== 背景色候補 ===")
    for name, info in backgrounds.items():
        print(f"{name}: L*={info['L']} -> {info['hex']}")
    print()
    print("palettes.json / backgrounds.json を書き出しました。")


if __name__ == "__main__":
    main()
