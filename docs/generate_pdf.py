"""Generate specification PDF for AI CallCenter CRM System."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register Japanese fonts
FONT_DIR = "C:/Windows/Fonts"
pdfmetrics.registerFont(TTFont("NotoSansJP", os.path.join(FONT_DIR, "NotoSansJP-VF.ttf")))
pdfmetrics.registerFont(TTFont("Meiryo", os.path.join(FONT_DIR, "meiryo.ttc"), subfontIndex=0))
pdfmetrics.registerFont(TTFont("MeiryoBold", os.path.join(FONT_DIR, "meiryob.ttc"), subfontIndex=0))

FONT = "Meiryo"
FONT_BOLD = "MeiryoBold"

# Colors
PRIMARY = HexColor("#1a56db")
PRIMARY_LIGHT = HexColor("#e8edfb")
DARK = HexColor("#1f2937")
GRAY = HexColor("#6b7280")
LIGHT_BG = HexColor("#f9fafb")
BORDER = HexColor("#e5e7eb")
WHITE = white
ACCENT = HexColor("#2563eb")
SECTION_BG = HexColor("#1e40af")

# Styles
styles = {
    "title": ParagraphStyle("Title", fontName=FONT_BOLD, fontSize=22, leading=30, textColor=DARK, spaceAfter=4),
    "subtitle": ParagraphStyle("Subtitle", fontName=FONT, fontSize=10, leading=14, textColor=GRAY, spaceAfter=20),
    "h1": ParagraphStyle("H1", fontName=FONT_BOLD, fontSize=15, leading=22, textColor=PRIMARY, spaceBefore=16, spaceAfter=8),
    "h2": ParagraphStyle("H2", fontName=FONT_BOLD, fontSize=12, leading=18, textColor=DARK, spaceBefore=12, spaceAfter=6),
    "h3": ParagraphStyle("H3", fontName=FONT_BOLD, fontSize=10, leading=15, textColor=HexColor("#374151"), spaceBefore=8, spaceAfter=4),
    "body": ParagraphStyle("Body", fontName=FONT, fontSize=9, leading=14, textColor=DARK),
    "bullet": ParagraphStyle("Bullet", fontName=FONT, fontSize=9, leading=14, textColor=DARK, leftIndent=16, bulletIndent=6),
    "bold_body": ParagraphStyle("BoldBody", fontName=FONT_BOLD, fontSize=9, leading=14, textColor=DARK),
    "toc_item": ParagraphStyle("TOC", fontName=FONT, fontSize=10, leading=18, textColor=DARK, leftIndent=10),
    "table_header": ParagraphStyle("TH", fontName=FONT_BOLD, fontSize=8, leading=12, textColor=WHITE),
    "table_cell": ParagraphStyle("TD", fontName=FONT, fontSize=8, leading=12, textColor=DARK),
    "table_cell_bold": ParagraphStyle("TDB", fontName=FONT_BOLD, fontSize=8, leading=12, textColor=DARK),
    "page_label": ParagraphStyle("PageLabel", fontName=FONT, fontSize=9, leading=12, textColor=GRAY),
    "screen_info": ParagraphStyle("ScreenInfo", fontName=FONT, fontSize=8.5, leading=13, textColor=ACCENT),
}

PAGE_W, PAGE_H = A4
LEFT_MARGIN = 20 * mm
RIGHT_MARGIN = 20 * mm
TOP_MARGIN = 22 * mm
BOTTOM_MARGIN = 22 * mm
CONTENT_W = PAGE_W - LEFT_MARGIN - RIGHT_MARGIN


def header_footer(canvas, doc):
    canvas.saveState()
    # Header line
    canvas.setStrokeColor(PRIMARY)
    canvas.setLineWidth(0.5)
    canvas.line(LEFT_MARGIN, PAGE_H - 16 * mm, PAGE_W - RIGHT_MARGIN, PAGE_H - 16 * mm)
    canvas.setFont("Meiryo", 7)
    canvas.setFillColor(GRAY)
    canvas.drawString(LEFT_MARGIN, PAGE_H - 14 * mm, "AI CallCenter CRM System - 機能仕様書")
    # Footer
    canvas.setFont("Meiryo", 7)
    canvas.setFillColor(GRAY)
    canvas.drawRightString(PAGE_W - RIGHT_MARGIN, 14 * mm, f"- {doc.page} -")
    canvas.drawString(LEFT_MARGIN, 14 * mm, "最終更新: 2026-03-18")
    canvas.line(LEFT_MARGIN, 18 * mm, PAGE_W - RIGHT_MARGIN, 18 * mm)
    canvas.restoreState()


def make_table(headers, rows, col_widths=None):
    """Create a styled table."""
    all_data = []
    header_cells = [Paragraph(h, styles["table_header"]) for h in headers]
    all_data.append(header_cells)
    for row in rows:
        cells = []
        for i, cell in enumerate(row):
            if i == 0:
                cells.append(Paragraph(str(cell), styles["table_cell_bold"]))
            else:
                cells.append(Paragraph(str(cell), styles["table_cell"]))
        all_data.append(cells)

    if col_widths is None:
        n = len(headers)
        col_widths = [CONTENT_W / n] * n

    t = Table(all_data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), SECTION_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
    ]
    # Alternating row colors
    for i in range(1, len(all_data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), LIGHT_BG))
        else:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), WHITE))

    t.setStyle(TableStyle(style_cmds))
    return t


def hr():
    return HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceBefore=6, spaceAfter=6)


def build_pdf():
    output_path = os.path.join(os.path.dirname(__file__), "specification.pdf")
    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        leftMargin=LEFT_MARGIN, rightMargin=RIGHT_MARGIN,
        topMargin=TOP_MARGIN, bottomMargin=BOTTOM_MARGIN
    )

    story = []

    # ========== COVER / TITLE ==========
    story.append(Spacer(1, 30 * mm))
    story.append(Paragraph("AI CallCenter CRM System", styles["title"]))
    story.append(Paragraph("機能仕様書", ParagraphStyle("BigTitle", fontName=FONT_BOLD, fontSize=28, leading=36, textColor=PRIMARY)))
    story.append(Spacer(1, 10 * mm))
    story.append(HRFlowable(width="60%", thickness=2, color=PRIMARY, spaceAfter=8))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph("最終更新: 2026-03-18", styles["subtitle"]))
    story.append(Spacer(1, 20 * mm))

    # TOC
    story.append(Paragraph("目次", styles["h1"]))
    story.append(hr())
    toc_items = [
        "1. システム概要", "2. ユーザー権限", "3. ダッシュボード", "4. 架電画面",
        "5. リコール管理", "6. 案件管理", "7. AI評価", "8. 架電結果",
        "9. 架電リスト（CSVインポート）", "10. CPA/案件質分析",
        "11. スクリプト管理", "12. ユーザー管理", "13. メッセージ機能",
        "付録: データベース主要テーブル"
    ]
    for item in toc_items:
        story.append(Paragraph(item, styles["toc_item"]))
    story.append(PageBreak())

    # ========== 1. SYSTEM OVERVIEW ==========
    story.append(Paragraph("1. システム概要", styles["h1"]))
    story.append(hr())

    story.append(Paragraph("技術構成", styles["h2"]))
    story.append(make_table(
        ["項目", "技術"],
        [
            ["フロントエンド", "Next.js (React)"],
            ["バックエンド", "Express.js (Node.js)"],
            ["データベース", "MySQL (Railway)"],
            ["ホスティング", "Railway (自動デプロイ)"],
            ["AI", "OpenAI GPT (通話評価/分析)"],
            ["外部連携", "Google Sheets API (文字起こしログ)"],
        ],
        [CONTENT_W * 0.3, CONTENT_W * 0.7]
    ))
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("認証方式", styles["h2"]))
    for b in [
        "オペレーター: 名前選択でログイン（パスワードなし）",
        "管理者/マネージャー/営業: メールアドレス + パスワード",
        "JWT トークンによるセッション管理",
        "ログイン時にlocalStorageへトークン保存（端末ごとに独立）",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 6 * mm))

    # ========== 2. USER ROLES ==========
    story.append(Paragraph("2. ユーザー権限", styles["h1"]))
    story.append(hr())
    story.append(make_table(
        ["権限", "説明", "アクセス可能な機能"],
        [
            ["operator", "オペレーター", "ダッシュボード、架電画面、リコール、案件管理、AI評価、架電結果、架電リスト、メッセージ"],
            ["manager", "マネージャー", "上記 + パフォーマンス閲覧、スクリプト管理、CPA分析、架電ログ管理"],
            ["admin", "管理者", "全機能（ユーザー管理含む）"],
            ["sales", "営業", "ダッシュボード、案件管理（閲覧中心）、メッセージ"],
        ],
        [CONTENT_W * 0.12, CONTENT_W * 0.15, CONTENT_W * 0.73]
    ))
    story.append(Spacer(1, 6 * mm))

    # ========== 3. DASHBOARD ==========
    story.append(Paragraph("3. ダッシュボード", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /  (トップページ)　　権限: 全ロール", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("3.1 KPI カード", styles["h2"]))
    story.append(Paragraph("上部の期間タブ（日別/週別/月別/累計）で全KPIとグラフが連動して切り替わる。", styles["body"]))
    story.append(Spacer(1, 2 * mm))
    story.append(make_table(
        ["KPI", "説明", "補助情報"],
        [
            ["稼働時間", "手動入力の勤務時間（クリックで入力モーダル）", "平均h/日"],
            ["コール数", "期間内の総架電数（SKIP除外）", "/h"],
            ["リコール獲得", "リコール設定した件数", "/h"],
            ["リコール消化", "完了したリコール件数", "/h"],
            ["有効接続", "相手と会話できた件数", "/h"],
            ["担当接続", "担当者と会話できた件数", "/h"],
            ["案件獲得", "案件化した件数", "h/件"],
        ],
        [CONTENT_W * 0.18, CONTENT_W * 0.62, CONTENT_W * 0.2]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("3.2 スコープ切替（管理者/マネージャーのみ）", styles["h2"]))
    for b in ["全体: チーム全員の合算値", "オペレーター別: 個人を選択して表示"]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("3.3 グラフ", styles["h2"]))
    story.append(make_table(
        ["グラフ", "内容", "表示形式"],
        [
            ["時間帯別コール数", "9時~19時の各時間帯のコール数", "棒グラフ"],
            ["業種別案件化率", "案件化コールの業種別構成比", "円グラフ"],
            ["時間帯x業種別 接続数/接続率", "時間帯と業種のクロス集計", "テーブル"],
        ],
        [CONTENT_W * 0.3, CONTENT_W * 0.45, CONTENT_W * 0.25]
    ))
    story.append(Paragraph("全グラフはメインの期間タブに連動して表示が切り替わる。", styles["body"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("3.4 コピー機能", styles["h2"]))
    story.append(make_table(
        ["ボタン", "内容"],
        [
            ["コールデータ", "KPI値を改行区切りでクリップボードにコピー"],
            ["日報コピー", "「コール時間：XX」形式の日報テキストをコピー"],
        ],
        [CONTENT_W * 0.25, CONTENT_W * 0.75]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("3.5 AI総合分析（管理者/マネージャーのみ）", styles["h2"]))
    for b in [
        "チーム全体 or 個人のパフォーマンスをAIが分析",
        "期間指定（日別/週別/月別/累計）",
        "AIコーチング（個人選択時）",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(PageBreak())

    # ========== 4. CALL SCREEN ==========
    story.append(Paragraph("4. 架電画面", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /call　　権限: operator, manager, admin", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("4.1 架電リスト", styles["h2"]))
    story.append(Paragraph("左サイドバーに最大10件の架電対象を表示。ピックアップモード:", styles["body"]))
    story.append(Spacer(1, 2 * mm))
    story.append(make_table(
        ["モード", "説明"],
        [
            ["自動", "優先順位に基づいて自動選択（デフォルト）"],
            ["業種別", "業種を選択してフィルタリング"],
            ["自作", "自作リストからピックアップ"],
            ["特別", "特別リストからピックアップ"],
        ],
        [CONTENT_W * 0.2, CONTENT_W * 0.8]
    ))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph("優先順位ロジック:", styles["h3"]))
    for i, b in enumerate([
        "優先オペレーター割当（猶予日数内）",
        "架電回数が少ない企業を優先",
        "最終架電からの経過日数",
        "NG企業・既存案件リスト除外",
    ], 1):
        story.append(Paragraph(f"{i}. {b}", styles["bullet"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("4.2 企業情報表示", styles["h2"]))
    for b in [
        '会社名（クリックで「会社名 ハローワーク」Google検索）',
        "電話番号、業種、地域、住所",
        "過去の架電履歴（結果コード、メモ、日時）",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("4.3 架電結果入力", styles["h2"]))
    story.append(make_table(
        ["結果コード", "説明"],
        [
            ["NO_ANSWER", "不通"],
            ["NG", "不在/拒否"],
            ["RECALL", "リコール（日時指定）"],
            ["INTERESTED", "興味あり"],
            ["PROJECT", "案件化"],
            ["SKIP", "スキップ（集計対象外）"],
        ],
        [CONTENT_W * 0.25, CONTENT_W * 0.75]
    ))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph("入力項目:", styles["h3"]))
    for b in [
        "結果コード（必須）", "メモ（任意）", "有効接続チェック",
        "担当接続チェック", "リコール日時（RECALL選択時）",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("4.4 スクリプトパネル", styles["h2"]))
    for b in ["切り返しトーク・Q&Aを検索/閲覧", "業種フィルタリング対応"]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("4.5 ロック機構", styles["h2"]))
    for b in ["企業単位で排他ロック（5分タイムアウト）", "他のオペレーターが架電中の企業は表示されない"]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(PageBreak())

    # ========== 5. RECALLS ==========
    story.append(Paragraph("5. リコール管理", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /recalls　　権限: operator, manager, admin", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("タブ分類", styles["h2"]))
    story.append(make_table(
        ["タブ", "対象"],
        [
            ["今日", "本日期限のリコール"],
            ["明日", "翌日期限のリコール"],
            ["期限超過", "期限切れの未完了リコール"],
            ["その他", "上記以外の予定リコール"],
        ],
        [CONTENT_W * 0.2, CONTENT_W * 0.8]
    ))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph("操作", styles["h2"]))
    for b in [
        "完了: リコールを消化済みにする",
        "キャンセル: リコールを取消す",
        "通話文字起こしの閲覧",
        "クリックで架電画面へ遷移",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 6 * mm))

    # ========== 6. PROJECTS ==========
    story.append(Paragraph("6. 案件管理", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /projects, /projects/[id]　　権限: 全ロール（営業は閲覧中心）", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("6.1 案件一覧", styles["h2"]))
    for b in [
        "ステータスフィルタ、日付範囲フィルタ、自分の案件フィルタ",
        "インライン ステータス変更: 一覧上でプルダウンから直接ステータスを変更可能",
        "案件クリックで詳細画面へ遷移",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("6.2 ステータス一覧", styles["h2"]))
    story.append(make_table(
        ["ステータス", "説明"],
        [
            ["BOSHUCHU", "募集中"], ["SHORUI_CHU", "書類選考中"], ["SHORUI_OCHI", "書類落ち"],
            ["MENSETSU_KAKUTEI", "面接確定"], ["KEKKA_MACHI", "結果待ち"],
            ["NAITEI", "内定"], ["NAITEI_TORIKESHI", "内定取消"],
            ["FUGOKAKU", "不合格"], ["LOST", "失注"], ["BARASHI", "バラシ"],
            ["HORYU", "保留"], ["KISON_NASHI", "既存なし"],
            ["MODOSHI", "戻し"], ["MODORI", "戻り"],
        ],
        [CONTENT_W * 0.35, CONTENT_W * 0.65]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("6.3 案件詳細", styles["h2"]))
    for b in [
        "企業情報の表示/編集",
        "案件情報の編集（求人番号、面接日、面接種別、書類選考有無、メール送付/電話確認フラグ、メモ）",
        "過去の架電履歴タイムライン",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("6.4 内定者情報", styles["h2"]))
    story.append(Paragraph('ステータスを「内定」に変更すると自動でモーダルが表示される。一覧画面・詳細画面どちらからでも動作する。', styles["body"]))
    story.append(Spacer(1, 2 * mm))
    story.append(make_table(
        ["入力項目", "説明", "備考"],
        [
            ["登録番号", "候補者の登録番号", "例: AB1234"],
            ["コース", "国内/転職/海外", "プルダウン選択"],
            ["初回入金", "初回入金額", "半角数字のみ、例: 200000"],
            ["見込売上", "見込売上額", "半角数字のみ、例: 1000000"],
        ],
        [CONTENT_W * 0.2, CONTENT_W * 0.4, CONTENT_W * 0.4]
    ))
    story.append(Paragraph("内定者数: 1件~複数件の入力が可能（人数選択後に入力欄が人数分表示）", styles["body"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("6.5 内定取消", styles["h2"]))
    for b in [
        'ステータスを「内定取消」に変更すると、全内定者の初回入金/見込売上が0にリセット',
        "個別取消: 内定者ごとにチェックボックスで取消可能（金額が0になる）",
        "復活: チェックを外すと金額を再編集可能（可逆操作）",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(PageBreak())

    # ========== 7. AI EVALUATION ==========
    story.append(Paragraph("7. AI評価", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /logs　　権限: operator, manager, admin", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("7.1 評価対象", styles["h2"]))
    for b in [
        "文字起こしログが15行以上の通話のみが評価対象",
        "15行未満は門前払い（短すぎて評価不能）のため自動スキップ",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("7.2 評価項目（5次元 x 100点）", styles["h2"]))
    story.append(make_table(
        ["項目", "説明"],
        [
            ["オープニング", "挨拶・自己紹介・用件提示の品質"],
            ["明瞭さ", "話し方の分かりやすさ・論理性"],
            ["ヒアリング", "相手のニーズ把握力"],
            ["切り返し", "反論・断りへの対応力"],
            ["クロージング", "次のアクションへの誘導力"],
        ],
        [CONTENT_W * 0.25, CONTENT_W * 0.75]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("7.3 フィードバック内容", styles["h2"]))
    for b in ["良かった点（箇条書き）", "改善点（箇条書き）", "次回アクション提案"]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("7.4 操作", styles["h2"]))
    story.append(make_table(
        ["機能", "説明"],
        [
            ["個別評価", "1件ずつAI評価を実行"],
            ["一括評価", "指定日の全通話を一括評価（日次制限あり）"],
            ["日次サマリー", "日別の平均スコアと傾向を表示"],
            ["電話番号検索", "CRM + Google Sheetsから通話ログを横断検索"],
        ],
        [CONTENT_W * 0.25, CONTENT_W * 0.75]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("7.5 管理者向け機能", styles["h2"]))
    for b in ["全オペレーターの評価一覧閲覧", "AI評価に基づくスクリプト提案の自動生成"]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 6 * mm))

    # ========== 8. CALL RESULTS ==========
    story.append(Paragraph("8. 架電結果", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /call-results　　権限: operator, manager, admin", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("機能", styles["h2"]))
    for b in [
        "日別/範囲/全件の表示切替",
        "フィルタ: 結果コード、オペレーター、会社名/電話番号/メモ検索",
        "インライン編集: 結果コード、メモ、接続フラグを一覧上で直接編集",
        "通話時間の自動計算・表示",
        "文字起こし展開表示",
        "ページネーション",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(PageBreak())

    # ========== 9. CSV IMPORT ==========
    story.append(Paragraph("9. 架電リスト（CSVインポート）", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /csv-import　　権限: operator, manager, admin（一部manager以上）", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("9.1 インポート種別", styles["h2"]))
    story.append(make_table(
        ["種別", "説明", "権限"],
        [
            ["架電リスト", "通常の架電対象企業リスト", "全員"],
            ["特別リスト", "特別リスト専用企業（自動/業種タブには非表示）", "manager以上"],
            ["NGリスト", "架電除外企業リスト", "manager以上"],
            ["既存案件リスト", "既に案件化済みの企業リスト（除外用）", "manager以上"],
        ],
        [CONTENT_W * 0.2, CONTENT_W * 0.55, CONTENT_W * 0.25]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("9.2 インポート方法", styles["h2"]))
    for b in [
        "ファイル: CSV / XLS / XLSX 形式対応（ドラッグ&ドロップ可）",
        "手動入力: 1件ずつフォームから登録",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("9.3 CSVフォーマット", styles["h2"]))
    story.append(Paragraph("会社名, 電話番号, 業種, 職種, 住所, コメント", styles["body"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("9.4 重複判定", styles["h2"]))
    for b in [
        "架電リスト: 電話番号の一致で判定",
        "特別リスト: 特別リスト内で電話番号 or 会社名の一致で判定",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("9.5 優先オペレーター割当（manager以上）", styles["h2"]))
    for b in [
        "インポート時にオペレーターと猶予日数を指定",
        "指定期間中は該当オペレーターが優先的にピックアップ",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("9.6 企業一覧管理", styles["h2"]))
    for b in [
        "業種・地域・除外フラグでフィルタ",
        "ロック状態のリアルタイム表示（30秒更新）",
        "ピックアップボタンで架電画面へ遷移",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 6 * mm))

    # ========== 10. CPA / ANALYTICS ==========
    story.append(Paragraph("10. CPA/案件質分析", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /admin/analytics　　権限: manager, admin", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("10.1 表示形式", styles["h2"]))
    for b in [
        "全オペレーター比較テーブル: オペレーターが行、指標が列",
        "管理者は表示されない（オペレーターのみ）",
        "全体行（チーム合算）が先頭に表示",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("10.2 期間切替", styles["h2"]))
    story.append(make_table(
        ["モード", "説明"],
        [
            ["月別", "月選択で該当月のデータ表示"],
            ["週別", "月選択で該当月の全週を一覧表示（切替なし、比較しやすい）"],
            ["累計", "全期間の累積データ"],
        ],
        [CONTENT_W * 0.2, CONTENT_W * 0.8]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("10.3 CPA指標", styles["h2"]))
    story.append(make_table(
        ["指標", "説明"],
        [
            ["コスト", "出勤記録 x 時給1,500円"],
            ["コール数", "総架電数"],
            ["案件化率", "案件数 / コール数 x 100"],
            ["案件数", "案件化した件数"],
            ["案件CPA", "コスト / 案件数"],
            ["面接数", "面接実施件数"],
            ["面接CPA", "コスト / 面接数"],
            ["内定", "内定件数"],
            ["不合格", "不合格件数"],
            ["バラシ/失注", "バラシ + 失注の合計"],
            ["初回入金", "内定者の初回入金合計（取消分除外）"],
            ["見込売上", "内定者の見込売上合計（取消分除外）"],
            ["ROAS", "初回入金 / コスト x 100"],
        ],
        [CONTENT_W * 0.2, CONTENT_W * 0.8]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("10.4 案件質指標", styles["h2"]))
    story.append(make_table(
        ["指標", "説明"],
        [
            ["案件数", "総案件数"],
            ["失注", "失注件数と割合"],
            ["連絡待ち", "メール未送付 かつ 電話未確認の件数と割合"],
            ["面接日確定", "面接日が設定済みの件数と割合"],
            ["面接実施", "面接を実施した件数と割合"],
            ["バラシ", "バラシ件数と割合"],
            ["オンライン面接", "オンライン面接の件数と割合"],
            ["書類選考無し", "書類選考不要の件数と割合"],
            ["書類選考落ち", "書類で落ちた件数と割合"],
        ],
        [CONTENT_W * 0.2, CONTENT_W * 0.8]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("10.5 コストデータ取込", styles["h2"]))
    story.append(Paragraph("コストは出勤記録（cost_records）から算出。オペレーターが入力した稼働時間（work_hours）は使用しない。", styles["body"]))
    story.append(Spacer(1, 2 * mm))
    story.append(make_table(
        ["形式", "説明"],
        [
            ["CSV", "日付, 名前, 開始, 終了, 休憩(分) 形式"],
            ["PDF", "出勤表PDFから自動抽出（日付・名前・時刻を解析）"],
        ],
        [CONTENT_W * 0.15, CONTENT_W * 0.85]
    ))
    story.append(PageBreak())

    # ========== 11. SCRIPTS ==========
    story.append(Paragraph("11. スクリプト管理", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /admin/scripts　　権限: manager, admin（閲覧はoperatorも可）", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("スクリプト種別", styles["h2"]))
    story.append(make_table(
        ["種別", "説明"],
        [
            ["切り返しトーク", "断り文句への対応スクリプト"],
            ["Q&A", "よくある質問と回答"],
        ],
        [CONTENT_W * 0.25, CONTENT_W * 0.75]
    ))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("ワークフロー", styles["h2"]))
    for i, b in enumerate([
        "管理者/マネージャーがスクリプトを作成",
        "承認/却下の管理",
        "承認済みスクリプトがオペレーターの架電画面に表示",
        "業種フィルタリング対応",
    ], 1):
        story.append(Paragraph(f"{i}. {b}", styles["bullet"]))
    story.append(Spacer(1, 6 * mm))

    # ========== 12. USERS ==========
    story.append(Paragraph("12. ユーザー管理", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /admin/users　　権限: admin のみ", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("機能", styles["h2"]))
    for b in [
        "ユーザーの作成/編集/削除",
        "ロール割当（operator / manager / admin / sales）",
        "アクティブ/非アクティブ切替",
        "一覧表示（名前、メール、ロール、作成日）",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(Spacer(1, 6 * mm))

    # ========== 13. MESSAGES ==========
    story.append(Paragraph("13. メッセージ機能", styles["h1"]))
    story.append(hr())
    story.append(Paragraph("画面: /messages（ユーザー側）, /admin/requests（管理者側）　　権限: 全ロール", styles["screen_info"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("機能", styles["h2"]))
    for b in [
        "ユーザーが機能要望やフィードバックを送信",
        "管理者が全メッセージを閲覧・返信",
        "メッセージ一覧と返信履歴の表示",
    ]:
        story.append(Paragraph(b, styles["bullet"], bulletText="\u2022"))
    story.append(PageBreak())

    # ========== APPENDIX: DB TABLES ==========
    story.append(Paragraph("付録: データベース主要テーブル", styles["h1"]))
    story.append(hr())
    story.append(make_table(
        ["テーブル", "説明"],
        [
            ["users", "ユーザー情報（ロール、アクティブ状態）"],
            ["companies", "企業情報（業種、地域、ロック状態、除外フラグ）"],
            ["calls", "架電記録（結果、メモ、接続フラグ、文字起こし）"],
            ["projects", "案件情報（ステータス、面接情報、書類選考）"],
            ["project_hires", "内定者情報（登録番号、コース、入金、売上、取消フラグ）"],
            ["recall_tasks", "リコール予定（日時、ステータス）"],
            ["evaluations", "AI評価結果（5次元スコア、フィードバック）"],
            ["scripts", "スクリプト（種別、承認状態、業種）"],
            ["cost_records", "出勤記録（CSV/PDFインポート、CPA算出用）"],
            ["work_hours", "手動入力の稼働時間"],
            ["exclusion_lists", "NG/既存案件リスト"],
            ["feature_requests", "ユーザーからの要望・メッセージ"],
        ],
        [CONTENT_W * 0.25, CONTENT_W * 0.75]
    ))

    # Build
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"PDF generated: {output_path}")


if __name__ == "__main__":
    build_pdf()
