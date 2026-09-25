# -*- coding: utf-8 -*-
"""
本実験 PsychoPy版
=================
config.json / palettes.json を読み込み、
実験手続きを制御する。

動作要件:
  PsychoPy >= 2023.1  (psychopy パッケージ)
  Python >= 3.8

実行方法:
  python experiment.py
    または PsychoPy Coder / Runner から開く

データ出力:
  config.json の data_dir に CSV を保存
  ファイル名: <data_dir>/P<participant_id>_<timestamp>.csv

記録カラム:
  participant, trial_num, color_condition, target_count,
  time_limit_condition, click_order, grid_x, grid_y,
  color_level, hex_code, rt_ms, distance_px, timed_out
"""

import json
import math
import os
import random
import sys
import csv
import datetime

# PsychoPy のインポート（未インストールの場合はエラーメッセージを出して終了）
try:
    from psychopy import visual, core, event, gui, monitors
    from psychopy.tools.colorspacetools import hex2rgb255
except ImportError:
    print("PsychoPy がインストールされていません。")
    print("  pip install psychopy  を実行してください。")
    sys.exit(1)


# ==============================================================================
# 設定読み込み
# ==============================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def load_json(filename):
    path = os.path.join(SCRIPT_DIR, filename)
    if not os.path.exists(path):
        print(f"ファイルが見つかりません: {path}")
        sys.exit(1)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


CFG = load_json("config.json")
PALETTES = load_json(CFG["palette_file"])

GRID_SIZE  = CFG.get("grid_size", 5)
TIME_LIMIT = CFG.get("time_limit_sec", 5.0)
FIXATION_S = CFG.get("fixation_sec", 1.5)
POST_BLANK = CFG.get("post_blank_sec", 0.8)
REPS       = CFG.get("reps_per_cell", 3)
DATA_DIR   = os.path.join(SCRIPT_DIR, CFG.get("data_dir", "data"))

COLOR_CONDITIONS = CFG["color_conditions"]
TARGET_COUNTS    = CFG["target_counts"]
TIME_CONDITIONS  = CFG["time_limit_conditions"]  # [True, False]

os.makedirs(DATA_DIR, exist_ok=True)

# 背景色 (L*=50 グレー → PsychoPy RGB [-1,1] スケール)
BG_HEX        = "#777777"
DISTRACTOR_HEX = "#999999"

def hex_to_psychopy(hex_str):
    """#RRGGBB → PsychoPy RGB [-1, 1]"""
    h = hex_str.lstrip("#")
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return ((r / 127.5) - 1, (g / 127.5) - 1, (b / 127.5) - 1)

BG_COLOR          = hex_to_psychopy(BG_HEX)
DISTRACTOR_COLOR  = hex_to_psychopy(DISTRACTOR_HEX)


# ==============================================================================
# パレットユーティリティ
# ==============================================================================

def get_palette(color_condition, target_count):
    """palettes.json から対応するパレットエントリリストを返す"""
    key = f"{color_condition}_{target_count}"
    if key not in PALETTES:
        print(f"パレットキー '{key}' が palettes.json に存在しません。")
        sys.exit(1)
    return PALETTES[key]   # list of {"level":…, "L":…, "C":…, "h":…, "hex":"#..."}


# ==============================================================================
# 試行プラン生成
# ==============================================================================

def build_full_plan():
    """
    練習試行 + 本試行のリストを返す。
    各要素: dict with keys
      color_condition, target_count, time_limit, is_practice
    """
    plan = []

    # 練習試行
    for pt in CFG.get("practice_trials", []):
        plan.append({
            "color_condition": pt["color_condition"],
            "target_count":    pt["target_count"],
            "time_limit":      pt["time_limit"],
            "is_practice":     True,
        })

    # 本試行: block_order に従ってブロック生成
    # time_limit_first: True ブロック → False ブロック
    block_order = CFG.get("block_order", "time_limit_first")
    if block_order == "time_limit_first":
        tl_order = [True, False]
    else:
        tl_order = [False, True]

    for tl in tl_order:
        block_trials = []
        for cc in COLOR_CONDITIONS:
            for tc in TARGET_COUNTS:
                for _ in range(REPS):
                    block_trials.append({
                        "color_condition": cc,
                        "target_count":    tc,
                        "time_limit":      tl,
                        "is_practice":     False,
                    })
        random.shuffle(block_trials)
        plan.extend(block_trials)

    return plan


# ==============================================================================
# グリッドレイアウト計算
# ==============================================================================

CELL_SIZE_PX = 70    # セル一辺のピクセル数（要モニター調整）
GAP_PX       = 14    # セル間隔

def grid_positions(grid_size, win_height):
    """
    grid_size × grid_size のグリッド中心座標 (PsychoPy units=pix) を返す。
    戻り値: list of (x, y) タプル (行優先)
    """
    total = grid_size * (CELL_SIZE_PX + GAP_PX) - GAP_PX
    offsets = [i * (CELL_SIZE_PX + GAP_PX) - total / 2 + CELL_SIZE_PX / 2
               for i in range(grid_size)]
    positions = []
    for row in range(grid_size):
        for col in range(grid_size):
            x = offsets[col]
            y = -offsets[row]   # PsychoPy は上が正
            positions.append((x, y, row, col))
    return positions


# ==============================================================================
# メインウィンドウ・刺激セットアップ
# ==============================================================================

def setup_window():
    win = visual.Window(
        size=[1280, 800],
        fullscr=False,          # 実験実施時は True に変更
        color=BG_COLOR,
        colorSpace="rgb",
        units="pix",
        winType="pyglet",
        allowGUI=False,
    )
    return win


def make_fixation(win):
    return visual.TextStim(
        win, text="+", height=48,
        color=[1, 1, 1], colorSpace="rgb",
    )


def make_status_text(win):
    return visual.TextStim(
        win, text="", height=20,
        pos=[0, 340], color=[1, 1, 1], colorSpace="rgb",
        wrapWidth=700,
    )


def make_cells(win, grid_size):
    """グリッド上の Rect オブジェクトリストを作成"""
    all_pos = grid_positions(grid_size, 800)
    cells = []
    for (x, y, row, col) in all_pos:
        rect = visual.Rect(
            win,
            width=CELL_SIZE_PX, height=CELL_SIZE_PX,
            pos=(x, y),
            lineColor=None,
            fillColor=DISTRACTOR_COLOR,
            colorSpace="rgb",
        )
        cells.append({"rect": rect, "row": row, "col": col, "x": x, "y": y})
    return cells, all_pos


# ==============================================================================
# 単一試行実行
# ==============================================================================

def run_trial(win, cells, all_pos, fixation, status_text, mouse, trial_info,
              trial_num_display, total_main):
    """
    1試行を実行して結果辞書のリストを返す。
    1試行で target_count 回クリックが発生するため、
    記録は click_order=1..N のN行になる。
    """
    cc  = trial_info["color_condition"]
    tc  = trial_info["target_count"]
    tl  = trial_info["time_limit"]
    is_p = trial_info["is_practice"]

    palette = get_palette(cc, tc)   # tc 個のエントリ

    # --- グリッドセルをシャッフルして target / distractor を割り当て ---
    grid_count = GRID_SIZE * GRID_SIZE  # 25
    indices = list(range(grid_count))
    random.shuffle(indices)
    target_indices = set(indices[:tc])

    # セルカラーを設定
    cell_colors = []
    for i, cell in enumerate(cells):
        if i in target_indices:
            entry = palette[list(target_indices).index(i) % len(palette)]
            # 実際は palette をシャッフルしてレベルを割り当て
            pass
        cell_colors.append(None)

    # palette エントリをシャッフルして target セルに割り当て
    palette_shuffled = palette.copy()
    random.shuffle(palette_shuffled)
    target_list = sorted(target_indices)   # 固定順で割り当て
    random.shuffle(target_list)

    target_assignments = {}  # cell_index -> palette_entry
    for i, cell_idx in enumerate(target_list):
        target_assignments[cell_idx] = palette_shuffled[i]

    for i, cell in enumerate(cells):
        if i in target_indices:
            entry = target_assignments[i]
            cell["rect"].fillColor = hex_to_psychopy(entry["hex"])
            cell["level"] = entry["level"]
            cell["hex"]   = entry["hex"]
            cell["is_target"] = True
        else:
            cell["rect"].fillColor = DISTRACTOR_COLOR
            cell["level"] = None
            cell["hex"]   = DISTRACTOR_HEX
            cell["is_target"] = False

    # --- ステータステキスト ---
    if is_p:
        status_label = "【練習】"
    else:
        status_label = f"試行 {trial_num_display} / {total_main}"
    tl_label = "制限時間あり" if tl else "制限時間なし"
    status_text.text = f"{status_label}　{tl_label}　選択数: 0 / {tc}"

    # --- 注視点 ---
    fixation.draw()
    win.flip()
    core.wait(FIXATION_S)

    # --- 刺激表示 ---
    for cell in cells:
        cell["rect"].draw()
    status_text.draw()
    win.flip()

    trial_clock = core.Clock()
    mouse.clickReset()
    results = []
    click_order = 0
    clicked_cells = set()

    while True:
        # タイムアウトチェック
        elapsed = trial_clock.getTime()
        if tl and elapsed >= TIME_LIMIT:
            # タイムアウト: 未クリック target を timed_out=True で記録
            for cell_idx in target_indices:
                if cell_idx not in clicked_cells:
                    cell = cells[cell_idx]
                    click_order += 1
                    results.append({
                        "click_order":       click_order,
                        "grid_x":            cell["col"],
                        "grid_y":            cell["row"],
                        "color_level":       cell["level"] if cell["is_target"] else None,
                        "hex_code":          cell["hex"],
                        "rt_ms":             round(elapsed * 1000),
                        "distance_px":       None,
                        "timed_out":         True,
                    })
            break

        # マウスクリック検出
        buttons, times = mouse.getPressed(getTime=True)
        if buttons[0]:
            mx, my = mouse.getPos()
            mouse.clickReset()

            # どのセルがクリックされたか判定
            hit_cell = None
            hit_idx  = None
            for i, cell in enumerate(cells):
                cx, cy = cell["x"], cell["y"]
                half = CELL_SIZE_PX / 2
                if abs(mx - cx) <= half and abs(my - cy) <= half:
                    hit_cell = cell
                    hit_idx  = i
                    break

            if hit_cell is not None and hit_idx not in clicked_cells:
                clicked_cells.add(hit_idx)
                click_order += 1
                rt_ms = round(elapsed * 1000)

                # 前クリック位置からの距離
                if len(results) > 0:
                    prev = results[-1]
                    prev_cx = cells[prev["_cell_idx"]]["x"]
                    prev_cy = cells[prev["_cell_idx"]]["y"]
                    dist = math.sqrt((mx - prev_cx)**2 + (my - prev_cy)**2)
                else:
                    dist = None

                results.append({
                    "_cell_idx":         hit_idx,
                    "click_order":       click_order,
                    "grid_x":            hit_cell["col"],
                    "grid_y":            hit_cell["row"],
                    "color_level":       hit_cell["level"] if hit_cell["is_target"] else None,
                    "hex_code":          hit_cell["hex"],
                    "rt_ms":             rt_ms,
                    "distance_px":       round(dist, 1) if dist is not None else None,
                    "timed_out":         False,
                })

                # ビジュアルフィードバック: クリック済みセルを暗くする
                hit_cell["rect"].opacity = 0.4
                for cell in cells:
                    cell["rect"].draw()
                # クリックした位置にマーカー
                marker = visual.Circle(win, radius=8, pos=(mx, my),
                                       fillColor=[1, 1, 1], colorSpace="rgb",
                                       lineColor=None)
                marker.draw()
                status_text.text = (f"{status_label}　{tl_label}　"
                                    f"選択数: {click_order} / {tc}")
                status_text.draw()
                win.flip()

                if click_order >= tc:
                    break

        event.clearEvents("keyboard")
        if event.getKeys(["escape"]):
            win.close()
            sys.exit(0)

    # 選択後ブランク
    win.flip()
    core.wait(POST_BLANK)

    # _cell_idx を削除してから返す
    for r in results:
        r.pop("_cell_idx", None)

    # セルの opacity をリセット
    for cell in cells:
        cell["rect"].opacity = 1.0

    return results


# ==============================================================================
# 画面テキスト表示ユーティリティ
# ==============================================================================

def show_text_screen(win, text, wait_key=True):
    """テキスト画面を表示し、スペースキー待ち"""
    stim = visual.TextStim(
        win, text=text, height=18,
        color=[1, 1, 1], colorSpace="rgb",
        wrapWidth=700, alignText="left",
    )
    stim.draw()
    win.flip()
    if wait_key:
        event.waitKeys(keyList=["space", "return"])


def show_block_break(win, block_num, total_blocks):
    msg = (
        f"ブロック {block_num} / {total_blocks} が終わりました。\n\n"
        "少し休憩してください。\n\n"
        "準備ができたら スペースキー を押してください。"
    )
    show_text_screen(win, msg)


# ==============================================================================
# 参加者情報ダイアログ
# ==============================================================================

def get_participant_info():
    dlg = gui.Dlg(title="参加者情報")
    dlg.addField("参加者ID:", "001")
    dlg.addField("年齢:", "")
    dlg.addField("性別 (M/F/その他):", "")
    data = dlg.show()
    if not dlg.OK:
        sys.exit(0)
    return {
        "participant_id": data[0].strip() or "001",
        "age":            data[1].strip(),
        "gender":         data[2].strip(),
    }


# ==============================================================================
# CSV 保存
# ==============================================================================

FIELDNAMES = [
    "participant", "trial_num", "color_condition", "target_count",
    "time_limit_condition", "click_order", "grid_x", "grid_y",
    "color_level", "hex_code", "rt_ms", "distance_px", "timed_out",
]

def save_row(writer, participant_id, trial_num, trial_info, row):
    writer.writerow({
        "participant":          participant_id,
        "trial_num":            trial_num,
        "color_condition":      trial_info["color_condition"],
        "target_count":         trial_info["target_count"],
        "time_limit_condition": trial_info["time_limit"],
        "click_order":          row["click_order"],
        "grid_x":               row["grid_x"],
        "grid_y":               row["grid_y"],
        "color_level":          row.get("color_level", ""),
        "hex_code":             row["hex_code"],
        "rt_ms":                row["rt_ms"],
        "distance_px":          row.get("distance_px", ""),
        "timed_out":            row["timed_out"],
    })


# ==============================================================================
# メイン
# ==============================================================================

INSTRUCTIONS = """\
【本実験】色選択課題

この実験では、5×5 のグリッドが画面に表示されます。
グリッドの中にいくつかの「ターゲット」が含まれており、
それ以外のセルは灰色のディストラクタです。

ターゲットは色つきのセル（明るさや色相が異なる）です。
すべてのターゲットをできるだけ素早く・正確にクリックしてください。

ターゲット数は 4個 または 7個 です。
課題によっては制限時間（5秒）がある場合があります。

---
・画面上部のバナーで制限時間の有無を確認できます
・制限時間内に全てクリックできなかった場合は次の試行へ進みます
・Esc キーで実験を中止できます

スペースキーを押すと練習試行が始まります。
"""

POST_SURVEY_QUESTIONS = [
    "Q1. ターゲット数（4個・7個）は選び方（クリック順序）に影響しましたか？\n"
    "  1. まったく影響なかった\n  2. あまり影響なかった\n"
    "  3. やや影響した\n  4. かなり影響した",

    "Q2. 色の違いはターゲットを見つける助けになりましたか？\n"
    "  1. まったく助けにならなかった\n  2. あまり助けにならなかった\n"
    "  3. やや助けになった\n  4. とても助けになった",

    "Q3. 制限時間はクリック順序に影響しましたか？\n"
    "  1. まったく影響なかった\n  2. あまり影響なかった\n"
    "  3. やや影響した\n  4. かなり影響した",
]


def run_post_survey(win, participant_id, data_dir):
    """簡易アンケートを実施して回答をテキストファイルに保存"""
    answers = {}
    for q in POST_SURVEY_QUESTIONS:
        prompt = q + "\n\n数字キー(1〜4)で回答してください。"
        stim = visual.TextStim(win, text=prompt, height=18,
                               color=[1, 1, 1], colorSpace="rgb",
                               wrapWidth=700, alignText="left")
        stim.draw()
        win.flip()
        keys = event.waitKeys(keyList=["1", "2", "3", "4", "escape"])
        if "escape" in keys:
            break
        answers[q.split("\n")[0]] = keys[0]

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = os.path.join(data_dir, f"P{participant_id}_survey_{ts}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(answers, f, ensure_ascii=False, indent=2)


def main():
    # 参加者情報
    pinfo = get_participant_info()
    pid   = pinfo["participant_id"]

    # ウィンドウ
    win   = setup_window()
    mouse = event.Mouse(win=win)
    fixation    = make_fixation(win)
    status_text = make_status_text(win)

    # グリッドセル
    cells, all_pos = make_cells(win, GRID_SIZE)

    # 試行プラン
    plan = build_full_plan()
    practice_count = sum(1 for t in plan if t["is_practice"])
    main_count     = sum(1 for t in plan if not t["is_practice"])

    # ブロック境界（練習後、time_limit=True ブロック終了地点）
    block1_size = REPS * len(COLOR_CONDITIONS) * len(TARGET_COUNTS)
    block1_end_idx = practice_count + block1_size  # exclusive

    # CSV ファイル
    ts       = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = os.path.join(DATA_DIR, f"P{pid}_{ts}.csv")
    csv_file = open(csv_path, "w", newline="", encoding="utf-8")
    writer   = csv.DictWriter(csv_file, fieldnames=FIELDNAMES)
    writer.writeheader()

    # 教示画面
    show_text_screen(win, INSTRUCTIONS)

    # 練習終了メッセージ用
    practice_done_shown = False
    main_trial_num = 0  # 本試行カウンタ

    try:
        for global_idx, trial_info in enumerate(plan):
            is_p = trial_info["is_practice"]

            # 練習→本試行の切り替えメッセージ
            if not is_p and not practice_done_shown:
                show_text_screen(win,
                    "練習終了です。お疲れ様でした。\n\n"
                    "これから本試行が始まります。\n"
                    "スペースキーを押してください。")
                practice_done_shown = True

            # ブロック間休憩（本試行ブロック1→2の切り替え）
            if global_idx == block1_end_idx:
                show_block_break(win, 1, 2)

            if not is_p:
                main_trial_num += 1

            results = run_trial(
                win, cells, all_pos, fixation, status_text, mouse,
                trial_info,
                trial_num_display=main_trial_num if not is_p else "練習",
                total_main=main_count,
            )

            trial_num_for_csv = main_trial_num if not is_p else f"P{global_idx+1}"
            for row in results:
                save_row(writer, pid, trial_num_for_csv, trial_info, row)

            csv_file.flush()  # 逐次書き込み

    finally:
        csv_file.close()

    # 終了画面
    show_text_screen(win,
        "実験終了です。ご参加ありがとうございました。\n\n"
        "続いて簡単なアンケートを行います。\n"
        "スペースキーを押してください。")

    # アンケート
    run_post_survey(win, pid, DATA_DIR)

    show_text_screen(win,
        "アンケートにご協力ありがとうございました。\n\n"
        f"データは {csv_path} に保存されました。\n\n"
        "スペースキーを押して終了してください。")

    win.close()
    core.quit()


if __name__ == "__main__":
    main()
