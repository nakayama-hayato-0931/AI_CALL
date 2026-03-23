"""
移行前案件データインポートスクリプト
Excel → MySQL (Railway) に案件をis_legacy=1として保存
"""
import pandas as pd
import mysql.connector
import sys
import os
from datetime import datetime, timedelta

EXCEL_PATH = r'C:\Users\aaaas\OneDrive\デスクトップ\案件管理移行.xlsx'

DB_CONFIG = {
    'host': os.environ.get('DB_HOST', 'hopper.proxy.rlwy.net'),
    'port': int(os.environ.get('DB_PORT', '11920')),
    'user': os.environ.get('DB_USER', 'root'),
    'password': os.environ.get('DB_PASSWORD', ''),
    'database': os.environ.get('DB_NAME', 'railway'),
    'charset': 'utf8mb4',
}

# 状況 → ステータスマッピング
STATUS_MAP = {
    '失注': 'LOST',
    '内定': 'NAITEI',
    '戻し': 'MODOSHI',
    '保留': 'HORYU',
    '募集中': 'BOSHUCHU',
    '面接確定': 'MENSETSU_KAKUTEI',
    '戻し戻り': 'MODORI',
    '結果待ち': 'KEKKA_MACHI',
    'バラシ': 'BARASHI',
    '不合格': 'FUGOKAKU',
    '書類選考落ち': 'SHORUI_OCHI',
    '書類選考中': 'SHORUI_CHU',
    '内定取消': 'NAITEI_TORIKESHI',
}

def excel_serial_to_date(serial):
    """Excel serial number to date string"""
    if pd.isna(serial) or not str(serial).strip():
        return None
    s = str(serial).strip()
    # Already a date string
    if '-' in s and len(s) >= 8:
        try:
            return pd.to_datetime(s).strftime('%Y-%m-%d')
        except:
            return None
    try:
        num = int(float(s))
        if num < 1 or num > 100000:
            return None
        base = datetime(1899, 12, 30)
        return (base + timedelta(days=num)).strftime('%Y-%m-%d')
    except:
        return None

def parse_bool(val):
    if pd.isna(val):
        return 0
    s = str(val).strip().lower()
    if s in ('true', '1', 'yes', 'o', '○'):
        return 1
    return 0

def parse_interview_date(date_val, time_val):
    """面接日 + 開始時間 → datetime"""
    d = excel_serial_to_date(date_val)
    if not d:
        return None
    if pd.notna(time_val) and str(time_val).strip():
        t = str(time_val).strip().replace('～', '').replace('〜', '').replace('　', '').replace(' ', '')
        # Extract first time (e.g., "15:00～")
        for sep in [':', '：']:
            if sep in t:
                parts = t.split(sep)
                try:
                    h = int(parts[0][-2:]) if len(parts[0]) > 2 else int(parts[0])
                    m = int(parts[1][:2])
                    return f"{d} {h:02d}:{m:02d}:00"
                except:
                    pass
    return f"{d} 00:00:00"

# 苗字 → フルネーム マッピング
OPERATOR_NAME_MAP = {
    '中田': '中田 倫哉',
    '中田 ※': '中田 倫哉',
    '吉田': '吉田 拓矢',
    '吉田(坂圦)': '吉田 拓矢',
    '常': '常 委',
    '渡邊': '渡邊 樹',
    '佐藤': '佐藤 綾香',
    '兒玉': '兒玉 良美',
    '寺西': '寺西 リナ',
    '小林': '小林 あや',
    '中嶋': '中嶋 太一',
    '海瀬': '海瀬 裕太',
    '森川': '森川 葵',
    # 以下は現在システムに未登録（移行前のみ）
    '谷口': '谷口',
    '浅川': '浅川',
    '喜納': '喜納',
    '坂圦': '坂圦',
    '武末': '武末',
    '岩松': '岩松',
}

def clean_text(val, max_len=None):
    if pd.isna(val):
        return None
    s = str(val).strip()
    if not s:
        return None
    if max_len:
        s = s[:max_len]
    return s

def main():
    print("Reading Excel...")
    df = pd.read_excel(EXCEL_PATH, dtype=str)
    print(f"Total rows: {len(df)}")

    print("Connecting to DB...")
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()

    # Delete existing legacy projects
    cursor.execute("DELETE FROM projects WHERE is_legacy = 1")
    print(f"Cleared {cursor.rowcount} existing legacy projects")

    inserted = 0
    skipped = 0

    for i, row in df.iterrows():
        company_name = clean_text(row.get('会社名'))
        if not company_name:
            skipped += 1
            continue

        # Clean company name (remove email prefixes)
        if '@' in company_name.split('\n')[0]:
            parts = company_name.split('\n')
            company_name = '\n'.join(parts[1:]).strip() if len(parts) > 1 else company_name
        company_name = company_name.replace('\n', ' ').strip()[:255]

        created_date = excel_serial_to_date(row.get('案件獲得日'))
        if not created_date:
            skipped += 1
            continue

        status = STATUS_MAP.get(clean_text(row.get('状況')), None)
        raw_op = clean_text(row.get('架電担当'), 100)
        operator_name = OPERATOR_NAME_MAP.get(raw_op, raw_op) if raw_op else None
        sales_name = clean_text(row.get('営業担当者'), 100)
        phone = clean_text(row.get('かけた電話番号'), 50)

        # 面接日
        interview_dt = parse_interview_date(row.get('面接日'), row.get('開始時間'))

        # 面接方法
        online_ok = parse_bool(row.get('オンライン\n面接OK'))
        interview_type = 'online' if online_ok else None

        # 書類選考
        no_screening = parse_bool(row.get('書類選考\n無し'))
        document_screening = 'なし' if no_screening else None

        # チェックボックス
        mail_sent = parse_bool(row.get('メール\n送付'))
        mail_replied = parse_bool(row.get('メール\n返信'))
        phone_confirmed = parse_bool(row.get('電話確認'))

        # 新規追加項目
        log_val = clean_text(row.get('ログ'))
        log_confirmed = parse_bool(row.get('ログ確認'))
        job_posted = parse_bool(row.get('求人済'))
        pre_confirmed = parse_bool(row.get('事前確認'))
        dashboard_checked = 1 if clean_text(row.get('ダッシュボード\n入力')) else 0

        # 企業担当者・連絡先
        contact_person = clean_text(row.get('担当者'), 100)
        contact_info = clean_text(row.get('連絡先(電話番号とメールアドレス)'), 255)

        # メモ (担当者の印象 + 備考 + 採用人数/営業メモ)
        memo_parts = []
        impression = clean_text(row.get('担当者の印象\n連絡可能時間帯'))
        if impression:
            memo_parts.append(f"【担当者印象】{impression}")
        remarks = clean_text(row.get('備考'))
        if remarks:
            memo_parts.append(f"【備考】{remarks}")
        sales_memo = clean_text(row.get('採用人数、状況、営業メモ'))
        if sales_memo:
            memo_parts.append(f"【営業メモ】{sales_memo}")
        temp = clean_text(row.get('温度感'))
        if temp:
            memo_parts.append(f"【温度感】{temp}")
        industry = clean_text(row.get('業種'))
        if industry:
            memo_parts.append(f"【業種】{industry}")
        memo = '\n'.join(memo_parts) if memo_parts else None

        # 求人番号 (ダッシュボード入力列にある場合)
        job_number = clean_text(row.get('ダッシュボード\n入力'), 100)

        try:
            cursor.execute("""
                INSERT INTO projects (
                    company_id, owner_user_id, status, job_number,
                    interview_date, interview_type, document_screening,
                    mail_sent, mail_replied, phone_confirmed,
                    memo, is_legacy,
                    legacy_company_name, legacy_phone, legacy_date,
                    legacy_operator_name, legacy_sales_name,
                    log_confirmed, job_posted, pre_confirmed,
                    contact_person, contact_info, dashboard_checked,
                    created_at
                ) VALUES (
                    NULL, NULL, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, 1,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s
                )
            """, (
                status, job_number,
                interview_dt, interview_type, document_screening,
                mail_sent, mail_replied, phone_confirmed,
                memo,
                company_name, phone, created_date,
                operator_name, sales_name,
                log_confirmed, job_posted, pre_confirmed,
                contact_person, contact_info, dashboard_checked,
                f"{created_date} 00:00:00",
            ))
            inserted += 1
        except Exception as e:
            print(f"Error row {i}: {e}")
            skipped += 1

    conn.commit()
    print(f"\nDone! Inserted: {inserted}, Skipped: {skipped}")
    cursor.close()
    conn.close()

if __name__ == '__main__':
    main()
