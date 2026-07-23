/**
 * 架電画面
 * 架電リスト + 企業情報 + 架電操作 + 結果入力
 * 排他制御: 選択時にロック取得、終話/スキップ時にロック解除
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../components/common/Layout';
import ProjectModal from '../components/ProjectModal';
import useAuth from '../hooks/useAuth';
import api from '../utils/api';
import toast from 'react-hot-toast';

const GMAIL_URL = 'https://mail.google.com/mail/u/0/?authuser=hitokiwa.recruit@gmail.com';
const DASHBOARD_URL = 'https://hitokiwa-dashboard.vercel.app/';

// ZoomPhone用の電話番号整形: ハイフン・空白・全角除去し、0始まりは+81に変換
const formatPhoneForZoom = (raw) => {
  if (!raw) return '';
  // 全角→半角、ハイフン・空白・括弧を除去
  let digits = String(raw)
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[^\d+]/g, ''); // 数字と+以外を全部除去
  if (digits.startsWith('+')) return digits; // 既に国際形式
  if (digits.startsWith('0')) return '+81' + digits.slice(1);
  return digits;
};

// ZoomPhone起動: 確実に新しいURLが送信されるよう<a>タグ経由で実行
// window.location.href は連続呼び出しで古い値が残ることがある
const launchZoomPhone = (phoneNumber) => {
  const url = `zoomphonecall://${phoneNumber}`;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_self';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 100);
    console.log('[ZoomPhone] 発信:', phoneNumber);
  } catch (e) {
    // フォールバック
    window.location.href = url;
  }
};

const RESULT_CODES = [
  { code: 'NO_ANSWER', label: '不通', bg: 'bg-gray-100', text: 'text-gray-700', activeBg: 'bg-gray-600', activeText: 'text-white' },
  { code: 'NG', label: 'NG', bg: 'bg-red-50', text: 'text-red-700', activeBg: 'bg-red-500', activeText: 'text-white' },
  { code: 'RECALL', label: 'リコール', bg: 'bg-amber-50', text: 'text-amber-700', activeBg: 'bg-amber-500', activeText: 'text-white' },
  { code: 'INTERESTED', label: '興味あり', bg: 'bg-blue-50', text: 'text-blue-700', activeBg: 'bg-blue-500', activeText: 'text-white' },
  { code: 'PROJECT', label: '案件化', bg: 'bg-emerald-50', text: 'text-emerald-700', activeBg: 'bg-emerald-500', activeText: 'text-white' },
];

const reasonLabels = {
  recall_due: 'リコール期限',
  golden_time: 'ゴールデンタイム',
  untouched: '未接触',
  retry_no_answer: '再架電',
  pickup: 'ピックアップ',
};

const reasonColors = {
  recall_due: 'bg-rose-50 text-rose-700',
  golden_time: 'bg-amber-50 text-amber-700',
  untouched: 'bg-sky-50 text-sky-700',
  retry_no_answer: 'bg-gray-100 text-gray-600',
  pickup: 'bg-indigo-50 text-indigo-700',
};

export default function CallPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isManager = user?.role === 'admin' || user?.role === 'manager';

  // 架電リスト
  const [targetList, setTargetList] = useState([]);
  const [excludedIds, setExcludedIds] = useState(() => new Set());
  const [listDebug, setListDebug] = useState(null);
  const [selecting, setSelecting] = useState(false); // 選択処理中フラグ（ボタン無効化用）
  const prefetchedListRef = useRef(null); // バックグラウンドで事前取得した次の候補リスト
  const prefetchPromiseRef = useRef(null); // 進行中のprefetchプロミス
  const [listLoading, setListLoading] = useState(true);

  // 選択中の企業
  const [company, setCompany] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState(null);
  const [callHistory, setCallHistory] = useState([]);
  const [reason, setReason] = useState('');
  // 企業のアクション履歴（架電 + FAX/メール等の手動アクション）
  const [companyActions, setCompanyActions] = useState([]);
  const [actionFormOpen, setActionFormOpen] = useState(false);
  const [newCompanyAction, setNewCompanyAction] = useState({ action_date: '', action_type: 'FAX', result: '', memo: '' });

  // 通話状態
  const [callId, setCallId] = useState(null);
  const [calling, setCalling] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const autoPausedRef = useRef(false);

  // 結果入力
  const [resultCode, setResultCode] = useState('');
  const [memo, setMemo] = useState('');
  const [recallAt, setRecallAt] = useState('');
  const [isEffective, setIsEffective] = useState(false);
  const [isPerson, setIsPerson] = useState(false);
  const [isProspect, setIsProspect] = useState(false);
  // 担当者情報（リコール or 担当者接続時のみ。全項目任意）
  const [contactPersonName, setContactPersonName] = useState('');
  const [contactPersonGender, setContactPersonGender] = useState('');
  const [contactPersonPhone, setContactPersonPhone] = useState('');
  const [contactPersonImpression, setContactPersonImpression] = useState('');
  // NG理由（NG選択時のみ）
  const [ngReason, setNgReason] = useState('');
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState(null);

  // ピックアップモード
  const [pickupMode, setPickupMode] = useState('auto'); // 'auto' | 'industry' | 'mylist' | 'special'
  const [selectedIndustry, setSelectedIndustry] = useState('');
  const [selectedRegion, setSelectedRegion] = useState(''); // 業種別モード時の地域絞込 (任意)
  const [availableRegions, setAvailableRegions] = useState([]); // 業種別ルールで設定されている地域

  // 特別リスト手動追加
  const [showSpecialAdd, setShowSpecialAdd] = useState(false);
  const [specialForm, setSpecialForm] = useState({ company_name: '', phone_number: '' });
  const [specialAdding, setSpecialAdding] = useState(false);
  const [specialOperatorId, setSpecialOperatorId] = useState('');
  const [operatorList, setOperatorList] = useState([]);

  // 未保存の結果がある場合のページ離脱防止
  useEffect(() => {
    const hasUnsaved = !!resultCode && !!callId;

    // ブラウザのタブ閉じ/リロード
    const handleBeforeUnload = (e) => {
      if (hasUnsaved) {
        e.preventDefault();
        e.returnValue = '架電結果が保存されていません。このページを離れますか？';
      }
    };

    // Next.js のページ遷移
    const handleRouteChange = (url) => {
      if (hasUnsaved && !window.confirm('架電結果が保存されていません。このページを離れますか？')) {
        router.events.emit('routeChangeError');
        throw 'Route change aborted by user';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    router.events.on('routeChangeStart', handleRouteChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      router.events.off('routeChangeStart', handleRouteChange);
    };
  }, [resultCode, callId, router]);

  // スクリプト（アウト返し・Q&A）
  const [scripts, setScripts] = useState([]);
  const [scriptTab, setScriptTab] = useState('rebuttal'); // 'rebuttal' | 'qa'
  const [scriptSearch, setScriptSearch] = useState('');
  const [scriptShowAll, setScriptShowAll] = useState(false);

  const selectedIdRef = useRef(null);
  selectedIdRef.current = selectedTargetId;

  const callIdRef = useRef(null);
  callIdRef.current = callId;

  // モードの最新値をrefで保持（async関数内のクロージャ問題を回避）
  const pickupModeRef = useRef(pickupMode);
  const selectedIndustryRef = useRef(selectedIndustry);
  const selectedRegionRef = useRef(selectedRegion);
  pickupModeRef.current = pickupMode;
  selectedIndustryRef.current = selectedIndustry;
  selectedRegionRef.current = selectedRegion;

  // 架電種別（営業 or オペレーター）
  const callType = user?.role === 'sales' ? 'sales' : 'operator';

  // モードパラメータ構築ヘルパー
  const getModeParams = useCallback(() => {
    const params = {};
    if (pickupMode !== 'auto') params.mode = pickupMode;
    if (pickupMode === 'industry' && selectedIndustry) {
      params.industry = selectedIndustry;
      if (selectedRegion) params.region = selectedRegion;
    }
    params.call_type = callType;
    return params;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupMode, selectedIndustry, selectedRegion]);

  // 業種選択時: 選択可能な地域リストを取得
  useEffect(() => {
    if (pickupMode !== 'industry' || !selectedIndustry) {
      setAvailableRegions([]);
      setSelectedRegion('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/companies/industry-regions', {
          params: { industry: selectedIndustry },
        });
        if (cancelled) return;
        const regions = data?.data?.regions || [];
        setAvailableRegions(regions);
        if (selectedRegion && !regions.includes(selectedRegion)) {
          setSelectedRegion('');
        }
      } catch (e) {
        if (!cancelled) setAvailableRegions([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupMode, selectedIndustry]);

  // 架電リスト取得
  // forceRefresh=true: バックエンドの 20秒キャッシュを無効化して再取得 (更新ボタン用)
  const fetchCallList = useCallback(async (forceRefresh = false) => {
    setListLoading(true);
    try {
      const params = getModeParams();
      if (forceRefresh) {
        params.refresh = 1;
        params._t = Date.now(); // URL cache-buster (ブラウザ/プロキシキャッシュ完全回避)
      }
      const { data } = await api.get('/api/companies/call-list', { params });
      let targets = data.data.targets || [];
      setListDebug(data.data.debug || null);
      // 二重保険: forceRefresh のときはクライアント側でも Fisher-Yates シャッフル。
      // (バックエンドの ORDER BY RAND() がデプロイ未反映でも確実に並び替わる)
      if (forceRefresh && targets.length > 1) {
        const sticky = targets.filter(t => t.reason === 'assigned' || t.reason === 'recall_due');
        const rest = targets.filter(t => t.reason !== 'assigned' && t.reason !== 'recall_due');
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        targets = [...sticky, ...rest];
      }
      setTargetList(targets);
      // リストが刷新されたら、もう存在しないIDは無効化セットから掃除
      setExcludedIds(prev => {
        if (prev.size === 0) return prev;
        const ids = new Set(targets.map(t => t.id));
        const next = new Set();
        prev.forEach(id => { if (ids.has(id)) next.add(id); });
        return next;
      });
      return targets;
    } catch (err) {
      const msg = err.response?.data?.message || '架電リストの取得に失敗しました';
      const status = err.response?.status;
      const detail = err.response?.data?.error;
      console.error('[fetchCallList] error', { status, msg, detail, err });
      // 自動ポーリング (forceRefresh=false) は静かに失敗。
      // 502 連発時のトーストスパムを防ぐためコンソールログのみ。
      if (forceRefresh) {
        toast.error(detail ? `${msg} [${status}] ${detail}` : `${msg}${status ? ` [${status}]` : ''}`, { duration: 5000 });
      }
      return [];
    } finally {
      setListLoading(false);
    }
  }, [getModeParams]);

  // 初回読み込み + モード変更時（fetchCallList は getModeParams に依存し、getModeParams は pickupMode/selectedIndustry に依存）
  useEffect(() => {
    fetchCallList();
  }, [fetchCallList]);

  // 架電中でない時、15秒ごとに自動リフレッシュ（他OPがピックアップした企業を除外するため）
  const manualRefreshAtRef = useRef(0);
  useEffect(() => {
    if (calling || selecting) return;
    const interval = setInterval(() => {
      // 直前30秒以内に手動「更新」が押されたらポーリングをスキップ
      // (決定論的ポーリングがランダム結果を上書きする事象を防ぐ)
      if (Date.now() - manualRefreshAtRef.current < 30000) return;
      fetchCallList();
    }, 15000);
    return () => clearInterval(interval);
  }, [calling, selecting, fetchCallList]);

  // 管理者: オペレーター一覧取得（特別リスト割り当て用）
  useEffect(() => {
    if (isManager) {
      api.get('/api/auth/operators').then(res => {
        if (res.data.success) setOperatorList(res.data.data);
      }).catch(() => {});
    }
  }, [isManager]);

  // 企業選択時にアクション履歴を取得（架電+手動アクション統合）
  useEffect(() => {
    if (!company?.id) {
      setCompanyActions([]);
      return;
    }
    const cid = company.id;
    api.get(`/api/companies/${cid}/actions`).then(res => {
      if (res.data.success && company?.id === cid) {
        setCompanyActions(res.data.data.actions || []);
      }
    }).catch(() => {});
  }, [company?.id]);

  const refreshCompanyActions = async () => {
    if (!company?.id) return;
    try {
      const { data } = await api.get(`/api/companies/${company.id}/actions`);
      if (data.success) setCompanyActions(data.data.actions || []);
    } catch (e) { /* ignore */ }
  };

  const submitCompanyAction = async () => {
    if (!company?.id) return;
    if (!newCompanyAction.action_date || !newCompanyAction.action_type) {
      toast.error('日付とアクション種別を入力してください');
      return;
    }
    try {
      await api.post(`/api/companies/${company.id}/actions`, newCompanyAction);
      toast.success('アクションを記録しました');
      setActionFormOpen(false);
      const today = new Date().toISOString().slice(0, 10);
      setNewCompanyAction({ action_date: today, action_type: 'FAX', result: '', memo: '' });
      refreshCompanyActions();
    } catch (e) {
      toast.error('記録に失敗しました');
    }
  };

  const deleteCompanyAction = async (actionId) => {
    if (!company?.id) return;
    if (typeof window !== 'undefined' && !window.confirm('削除しますか？')) return;
    try {
      await api.delete(`/api/companies/${company.id}/actions/${actionId}`);
      refreshCompanyActions();
    } catch (e) { toast.error('削除に失敗しました'); }
  };

  // ピックアップ: 架電リストページからのロック済み企業を自動読み込み
  useEffect(() => {
    if (!router.isReady) return;
    const pickupId = router.query.pickup;
    if (!pickupId) return;

    const loadPickedCompany = async () => {
      try {
        // 前のロックが残っていれば解除
        if (selectedTargetId && selectedTargetId !== parseInt(pickupId, 10)) {
          await api.post(`/api/companies/${selectedTargetId}/unlock`).catch(() => {});
        }
        // 過去架電画面などからの遷移ではロック未取得 → ここで取得
        const { data } = await api.post(`/api/companies/${pickupId}/lock`);
        setCompany(data.data.company);
        setCallHistory(data.data.callHistory || []);
        setSelectedTargetId(parseInt(pickupId, 10));
        setReason('pickup');
        resetForm();
        toast.success(`${data.data.company.company_name} をピックアップ`);
      } catch (err) {
        if (err.response?.status === 409) {
          toast.error(err.response?.data?.message || 'この企業は他のオペレーターが対応中です');
        } else if (err.response?.status === 404) {
          toast.error('企業が見つかりませんでした');
        } else {
          toast.error('ピックアップした企業の読み込みに失敗しました');
        }
      }
      // URLからpickupパラメータを削除（再読み込み防止）
      router.replace('/call', undefined, { shallow: true });
    };

    loadPickedCompany();
  }, [router.isReady, router.query.pickup]);

  // ページ離脱時にロック解除（ベストエフォート）
  useEffect(() => {
    const handleBeforeUnload = () => {
      // 未保存の通話は削除せず残す（架電結果ログから後で結果入力できるようにするため）。
      //   ※ 以前はここで cancel-beacon を呼んで未完了通話を削除していた。
      // ロック解除のみ行う
      const id = selectedIdRef.current;
      if (id) {
        navigator.sendBeacon(
          `/api/companies/${id}/unlock`,
          new Blob([JSON.stringify({})], { type: 'application/json' })
        );
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // スクリプト取得
  useEffect(() => {
    const fetchScripts = async () => {
      try {
        const { data } = await api.get('/api/scripts');
        setScripts(data.data || []);
      } catch (err) {
        // サイレント — スクリプト取得失敗は架電に影響しない
      }
    };
    fetchScripts();
  }, []);

  // フィルタ済みスクリプト
  const filteredScripts = useMemo(() => {
    let items = scripts.filter(s => s.type === scriptTab);
    // 業種フィルタ（企業選択中 & 全表示OFF）
    if (company?.industry && !scriptShowAll) {
      items = items.filter(s => !s.industry || s.industry === '' || s.industry === company.industry);
    }
    // 検索フィルタ
    if (scriptSearch.trim()) {
      const q = scriptSearch.trim().toLowerCase();
      items = items.filter(s =>
        s.trigger_text.toLowerCase().includes(q) || s.response_text.toLowerCase().includes(q)
      );
    }
    return items;
  }, [scripts, scriptTab, scriptSearch, scriptShowAll, company?.industry]);

  // ターゲット選択 & ロック取得
  const handleSelectTarget = async (target) => {
    if (calling || selecting) return;
    setSelecting(true);
    // 手動選択時はプリフェッチキャッシュを無効化（古い情報で次架電しないように）
    prefetchedListRef.current = null;
    // UI即時更新: 選択中の企業情報を即座に反映（ロック前でも表示を切替）
    setSelectedTargetId(target.id);
    // 先に仮のcompanyを設定（完全な情報はlock後に上書き）
    setCompany({ id: target.id, company_name: target.company_name, phone_number: target.phone_number, industry: target.industry, job_type: target.job_type, comment: target.comment, address: target.address, region: target.region, data_source: target.data_source });
    setCallHistory([]);
    setReason(target.reason);
    setResultCode('');
    setMemo('');
    setRecallAt('');
    setIsEffective(false);
    setIsPerson(false);
    setContactPersonName('');
    setContactPersonGender('');
    setContactPersonPhone('');
    setContactPersonImpression('');
    setNgReason('');
    try {
      // 前回の未保存通話は削除しない（結果未入力の枠として残し、後でログから入力できるように）
      // 前のロックを解除
      if (selectedTargetId && selectedTargetId !== target.id) {
        await api.post(`/api/companies/${selectedTargetId}/unlock`).catch(() => {});
      }
      // 新しいロックを取得
      const { data } = await api.post(`/api/companies/${target.id}/lock`);
      // ロック成功後、完全な企業情報で上書き
      setCompany(data.data.company);
      setCallHistory(data.data.callHistory || []);
    } catch (err) {
    const code = err.response?.data?.code;
      const status = err.response?.status;
      // 失敗したので仮選択を解除
      setCompany(null);
      setSelectedTargetId(null);

      if (status === 409 && code === 'ALREADY_EXCLUDED') {
        // リコール/興味あり/案件化/NG/スキップ済み（他オペが直前に登録した等）。
        // 古いリストが残っているだけなので、無効化表示＋リスト更新＋自動で次へ進む。
        setExcludedIds(prev => new Set(prev).add(target.id));
        toast(err.response?.data?.message || 'この企業は架電対象外です。次の企業に進みます。', { icon: 'ℹ️' });
        const fresh = await fetchCallList(true);
        const excludedNow = new Set(excludedIds).add(target.id);
        const next = (fresh || []).find(t => t.id !== target.id && !excludedNow.has(t.id));
        if (next) {
          setTimeout(() => handleSelectTarget(next), 0);
        }
      } else if (status === 409) {
        // 他オペレーターが現在通話中などのロック競合
        toast.error(err.response?.data?.message || 'この企業は他のオペレーターが対応中です');
        fetchCallList(true);
      } else {
        toast.error('選択に失敗しました');
      }  
    } finally {
      setSelecting(false);
    }
  };

  // フォームリセット（共通）
  const resetForm = () => {
    setResultCode('');
    setMemo('');
    setRecallAt('');
    setIsEffective(false);
    setIsPerson(false);
    setIsProspect(false);
    setContactPersonName('');
    setContactPersonGender('');
    setContactPersonPhone('');
    setContactPersonImpression('');
    setNgReason('');
  };

  // 自動で次の架電先へ進む（ロック取得まで。架電開始は手動）
  const autoAdvanceToNext = async (excludeId = null) => {
    try {
      // 最新リストを取得（refから最新モード値を取得）
      const params = {};
      if (pickupModeRef.current !== 'auto') params.mode = pickupModeRef.current;
      if (pickupModeRef.current === 'industry' && selectedIndustryRef.current) { params.industry = selectedIndustryRef.current; if (selectedRegionRef.current) params.region = selectedRegionRef.current; }
      if (excludeId) params.exclude = excludeId;
      const { data } = await api.get('/api/companies/call-list', { params });
      const targets = data.data.targets || [];
      setTargetList(targets);

      if (targets.length === 0) {
        // 架電対象なし → 空状態に戻す
        setCompany(null);
        setSelectedTargetId(null);
        setCallHistory([]);
        setReason('');
        toast('架電対象がなくなりました');
        return;
      }

      // 候補を順番にロック取得試行（競合時は自動で次候補へ）
      let nextTarget = null;
      let lockData = null;
      for (const t of targets) {
        try {
          const lockRes = await api.post(`/api/companies/${t.id}/lock`);
          nextTarget = t;
          lockData = lockRes.data.data;
          break;
        } catch (lockErr) {
          if (lockErr.response?.status === 409) continue;
          throw lockErr;
        }
      }

      if (!nextTarget || !lockData) {
        toast('全候補が他のオペレーターと競合しています');
        setCompany(null);
        setSelectedTargetId(null);
        await fetchCallList();
        return;
      }

      setCompany(lockData.company);
      setCallHistory(lockData.callHistory || []);
      setSelectedTargetId(nextTarget.id);
      setReason(nextTarget.reason);
      resetForm();

      toast.success(`次の架電先: ${lockData.company.company_name}`);
    } catch (err) {
      toast.error('自動選択に失敗しました');
      setCompany(null);
      setSelectedTargetId(null);
      await fetchCallList();
    }
  };

  // 自動架電モード: 次の架電先に進み、自動で架電開始
  // バックグラウンドで次の候補を事前取得
  const prefetchNextCallList = (excludeId = null) => {
    const params = {};
    if (pickupModeRef.current !== 'auto') params.mode = pickupModeRef.current;
    if (pickupModeRef.current === 'industry' && selectedIndustryRef.current) { params.industry = selectedIndustryRef.current; if (selectedRegionRef.current) params.region = selectedRegionRef.current; }
    if (excludeId) params.exclude = excludeId;
    const p = api.get('/api/companies/call-list', { params })
      .then(res => {
        prefetchedListRef.current = res.data?.data?.targets || [];
        return prefetchedListRef.current;
      })
      .catch(() => { prefetchedListRef.current = null; return null; })
      .finally(() => { prefetchPromiseRef.current = null; });
    prefetchPromiseRef.current = p;
    return p;
  };

  const autoAdvanceAndCall = async (excludeId = null) => {
    try {
      // 事前取得済みがあればそれを優先使用
      let targets;
      if (prefetchedListRef.current && prefetchedListRef.current.length > 0) {
        targets = prefetchedListRef.current;
        prefetchedListRef.current = null; // 使い切り
      } else if (prefetchPromiseRef.current) {
        // prefetch進行中なら待つ
        targets = (await prefetchPromiseRef.current) || [];
      } else {
        const params = {};
        if (pickupModeRef.current !== 'auto') params.mode = pickupModeRef.current;
        if (pickupModeRef.current === 'industry' && selectedIndustryRef.current) { params.industry = selectedIndustryRef.current; if (selectedRegionRef.current) params.region = selectedRegionRef.current; }
        if (excludeId) params.exclude = excludeId;
        const { data } = await api.get('/api/companies/call-list', { params });
        targets = data.data.targets || [];
      }
      setTargetList(targets);

      if (targets.length === 0) {
        // 架電対象なし → 自動架電モード終了
        setAutoMode(false);
        setCalling(false);
        setCompany(null);
        setSelectedTargetId(null);
        setCallHistory([]);
        setReason('');
        toast('架電対象がなくなりました。自動架電を終了します。');
        return;
      }

      // 候補を順番にロック取得試行（他オペレーター競合時は自動で次候補へ）
      let nextTarget = null;
      let lockData = null;
      for (const t of targets) {
        try {
          const lockRes = await api.post(`/api/companies/${t.id}/lock`);
          nextTarget = t;
          lockData = lockRes.data.data;
          break;
        } catch (lockErr) {
          if (lockErr.response?.status === 409) {
            // 他OPが取得済み → 次の候補を試行
            continue;
          }
          throw lockErr;
        }
      }

      if (!nextTarget || !lockData) {
        // 全候補が競合していた → リスト再取得のみ
        toast('全候補が他のオペレーターと競合しています。再取得します...');
        await fetchCallList();
        return;
      }

      const nextCompany = lockData.company;
      setCompany(nextCompany);
      setCallHistory(lockData.callHistory || []);
      setSelectedTargetId(nextTarget.id);
      setReason(nextTarget.reason);
      resetForm();

      // 自動で架電開始
      const callRes = await api.post('/api/calls/start', { company_id: nextCompany.id, call_type: callType });
      setCallId(callRes.data.data.callId);
      setCalling(true);
      const phoneForZoom = formatPhoneForZoom(nextCompany.phone_number);
      launchZoomPhone(phoneForZoom);
      toast.success(`自動架電: ${nextCompany.company_name}`);
      // 架電開始直後にバックグラウンドで次候補を事前取得
      setTimeout(() => prefetchNextCallList(nextCompany.id), 500);
    } catch (err) {
      toast.error('自動架電に失敗しました');
      setAutoMode(false);
      setCalling(false);
      setCompany(null);
      setSelectedTargetId(null);
      await fetchCallList();
    }
  };

  // 架電開始（手動）
  // 未保存の通話レコードをキャンセル
  const cancelUnsavedCall = async () => {
    if (callId) {
      try {
        await api.delete(`/api/calls/${callId}/cancel`);
      } catch (e) {
        // 既に結果保存済みの場合は無視
      }
      setCallId(null);
    }
  };

  const handleStartCall = async () => {
    if (!company) return;
    if (selecting) {
      toast('選択処理中です。完了までお待ちください');
      return;
    }
    // 念のため: company.id と selectedTargetId が一致しているか確認
    if (selectedTargetId && company.id !== selectedTargetId) {
      toast.error('選択情報が同期していません。もう一度企業を選んでください');
      return;
    }
    try {
      // 前回の未保存通話は削除しない（startCall側で同一企業の枠を再利用する）
      const { data } = await api.post('/api/calls/start', { company_id: company.id, call_type: callType });
      setCallId(data.data.callId);
      setCalling(true);
      setAutoMode(true);
      setAutoPaused(false);
      autoPausedRef.current = false;
      // ZoomPhone起動: zoomphonecall://電話番号 でZoom Phoneアプリを起動
      const phoneForZoom = formatPhoneForZoom(company.phone_number);
      launchZoomPhone(phoneForZoom);
      toast.success('自動架電モードを開始しました');
      // 架電中にバックグラウンドで次候補を事前取得
      setTimeout(() => prefetchNextCallList(company.id), 500);
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('ロックが失われました。もう一度選択してください。');
        fetchCallList();
      } else {
        const msg = err.response?.data?.message || '架電開始に失敗しました';
        toast.error(msg, { duration: 8000 });
      }
    }
  };

  // 終話 & 結果保存 → 自動で次へ
  const handleEndCall = async () => {
    if (!callId || !resultCode) {
      toast.error('結果コードを選択してください');
      return;
    }
    if (resultCode === 'RECALL' && !recallAt) {
      toast.error('リコール日時を入力してください');
      return;
    }
    if (resultCode === 'NG' && !ngReason) {
      toast.error('NG理由を選択してください');
      return;
    }
    const showContactFields = resultCode === 'RECALL' || isPerson;
    const submitEndCall = async (overwrite = false) => {
      return api.put(`/api/calls/${callId}/end`, {
        result_code: resultCode,
        memo,
        recall_at: recallAt || null,
        is_effective_connection: isEffective,
        is_person_in_charge: isPerson,
        is_prospect: resultCode === 'PROJECT' ? isProspect : false,
        overwrite,
        contact_person_name: showContactFields ? (contactPersonName || null) : null,
        contact_person_gender: showContactFields ? (contactPersonGender || null) : null,
        contact_person_phone: showContactFields ? (contactPersonPhone || null) : null,
        contact_person_impression: showContactFields ? (contactPersonImpression || null) : null,
        ng_reason: resultCode === 'NG' ? (ngReason || null) : null,
      });
    };
    try {
      let response;
      try {
        response = await submitEndCall(false);
      } catch (err) {
        // 409 = 同企業に既存の案件/リコール → 上書き確認
        if (err.response?.status === 409) {
          const d = err.response.data || {};
          const ok = typeof window !== 'undefined' && window.confirm(`${d.message || '既存レコードがあります。'}\n\nOK = 上書き保存 / キャンセル = 中止`);
          if (!ok) {
            toast.error('保存をキャンセルしました');
            return;
          }
          response = await submitEndCall(true);
        } else {
          throw err;
        }
      }
      toast.success('通話結果を保存しました');
      const prevId = selectedTargetId;
      const wasAutoMode = autoMode;
      const wasPaused = autoPausedRef.current;

      // フォームを即座にリセット（次の架電先に引き継がないようにする）
      resetForm();

      // 興味あり: Gmail開く + 自動架電停止
      if (resultCode === 'INTERESTED') {
        setAutoMode(false);
        setAutoPaused(false);
        autoPausedRef.current = false;
        setCalling(false);
        setCallId(null);
        window.open(GMAIL_URL, '_blank');
        await autoAdvanceToNext(prevId);
        return;
      }

      // 案件化: ダッシュボード+Gmail開く + モーダル表示 + 自動架電停止
      if (resultCode === 'PROJECT') {
        if (isProspect) {
          // 見込案件: Gmail・ダッシュボードは開かないが、モーダルは表示
          setAutoMode(false);
          setAutoPaused(false);
          autoPausedRef.current = false;
          setCalling(false);
          setCallId(null);
          setSavedProjectId(response.data.data.projectId);
          setShowProjectModal(true);
          toast.success('見込案件として保存しました');
        } else {
          setAutoMode(false);
          setAutoPaused(false);
          autoPausedRef.current = false;
          setCalling(false);
          setCallId(null);
          window.open(DASHBOARD_URL, '_blank');
          window.open(GMAIL_URL, '_blank');
          setSavedProjectId(response.data.data.projectId);
          setShowProjectModal(true);
        }
        await autoAdvanceToNext(prevId);
        return;
      }

      // 通話状態リセット
      setCalling(false);
      setCallId(null);

      if (wasAutoMode && !wasPaused) {
        // 自動架電モード: 次へ進み自動で架電開始
        await autoAdvanceAndCall(prevId);
      } else if (wasAutoMode && wasPaused) {
        // 一時停止中: 次の架電先に進むが架電はしない
        await autoAdvanceToNext(prevId);
        toast('一時停止中です。再開ボタンで自動架電を再開できます。');
      } else {
        // 手動モード: 次の架電先に進むだけ（架電開始は手動）
        await autoAdvanceToNext(prevId);
      }
    } catch (err) {
      const msg = err.response?.data?.message || '保存に失敗しました';
      toast.error(msg);
    }
  };

  // スキップ（架電せずに記録）— リストから任意の企業をスキップ
  const handleSkip = async (targetId, e) => {
    if (e) e.stopPropagation(); // リスト項目クリックの伝播を止める
    if (calling) return;
    try {
      // 選択中の企業をスキップする場合はロック解除も必要
      if (selectedTargetId === targetId) {
        await api.post(`/api/companies/${targetId}/unlock`).catch(() => {});
        setCompany(null);
        setSelectedTargetId(null);
      }
      await api.post('/api/calls/skip', { company_id: targetId });
      // リストから即座に除外 & プリフェッチキャッシュも無効化
      setTargetList(prev => prev.filter(t => t.id !== targetId));
      if (prefetchedListRef.current) {
        prefetchedListRef.current = prefetchedListRef.current.filter(t => t.id !== targetId);
      }
      toast.success('スキップしました');
    } catch (err) {
      toast.error('スキップに失敗しました');
    }
  };

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">架電画面</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {pickupMode === 'auto' ? '自動優先順位による架電対象' :
           pickupMode === 'industry' ? `業種別ピックアップ${selectedIndustry ? `（${selectedIndustry}）` : ''}` :
           pickupMode === 'special' ? '特別リストからピックアップ' :
           '自作リストからピックアップ'}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* 左: 架電リスト */}
        <div className="xl:col-span-1">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-bold text-gray-800">架電リスト</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    try {
                      const { data } = await api.post('/api/companies/unlock-all');
                      const n = data?.data?.released ?? 0;
                      toast.success(n > 0 ? `${n}件のロックを解除しました` : '解除対象がありません');
                      fetchCallList();
                    } catch (err) {
                      toast.error('ロック解除に失敗しました');
                    }
                  }}
                  className="text-[11px] text-amber-600 hover:text-amber-700 transition-colors flex items-center gap-1"
                  title="自分が架電中扱いで残っているピックアップロックを一括解除"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 019.9-1"></path>
                  </svg>
                  ロック解除
                </button>
                <button
                  onClick={() => {
                    manualRefreshAtRef.current = Date.now();
                    // sticky は recall_due のみ。assigned(自分割り当て) もシャッフル対象に含める。
                    // 過去架電あり+割り当て中の企業が常に先頭固定されるのを防ぐ。
                    let shuffledCount = 0;
                    let stickyCount = 0;
                    setTargetList(prev => {
                      const sticky = prev.filter(t => t.reason === 'recall_due');
                      const rest = prev.filter(t => t.reason !== 'recall_due');
                      for (let i = rest.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [rest[i], rest[j]] = [rest[j], rest[i]];
                      }
                      shuffledCount = rest.length;
                      stickyCount = sticky.length;
                      return [...sticky, ...rest];
                    });
                    if (shuffledCount > 0) {
                      toast.success(`${shuffledCount}件をシャッフルしました`, { duration: 1500 });
                    } else if (stickyCount > 0) {
                      toast(`全${stickyCount}件がリコールのため並び替え対象なし`, { duration: 3000, icon: 'i' });
                    } else {
                      toast.error('リストが空です', { duration: 2000 });
                    }
                    fetchCallList(true);
                  }}
                  disabled={listLoading}
                  className="text-xs font-semibold text-purple-600 hover:text-purple-800 transition-colors flex items-center gap-1 px-2 py-1 rounded-md bg-purple-50 hover:bg-purple-100"
                  title="リスト内をランダムに並び替え + サーバーから新候補も取得"
                >
                  <svg className={`w-3.5 h-3.5 ${listLoading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line>
                  </svg>
                  シャッフル
                </button>
              </div>
            </div>

            {/* 現在のフィルタ状態を可視化 (業種別が効いていない事象の診断用) */}
            <div className="text-[10px] mb-1 flex flex-wrap gap-x-2 gap-y-0.5">
              <span className="text-gray-400">モード:</span>
              <span className="font-semibold text-blue-600">{pickupMode}</span>
              {pickupMode === 'industry' && (
                <>
                  <span className="text-gray-400">業種:</span>
                  <span className={`font-semibold ${selectedIndustry ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {selectedIndustry || '(未選択!業種を選んでください)'}
                  </span>
                </>
              )}
            </div>
            {/* Tier別 ピックアップ件数 (DB全体での該当件数) */}
            {listDebug && (
              <div className="text-[10px] text-gray-400 mb-2 flex flex-wrap gap-x-2 gap-y-0.5">
                <span className={`${Number(listDebug.recall) >= 25 ? 'text-rose-600 font-semibold' : ''}`}>
                  リコール:{listDebug.recall ?? 0}
                </span>
                <span>ゴールデン:{listDebug.golden ?? 0}</span>
                <span className={`${Number(listDebug.untouched) === 0 ? 'text-amber-600 font-semibold' : ''}`}>
                  未架電:{listDebug.untouched ?? 0}
                </span>
                <span>過去不通:{listDebug.retry_no_answer ?? 0}</span>
                <span>過去NG:{listDebug.retry_ng ?? 0}</span>
                {listDebug.recall_only && (
                  <span className="basis-full text-rose-700">
                    ※ リコール期限の企業がリストを埋め尽くしています。リコール管理画面で古いタスクを整理してください
                  </span>
                )}
                {!listDebug.recall_only && Number(listDebug.untouched) === 0 && (Number(listDebug.retry_no_answer) > 0 || Number(listDebug.retry_ng) > 0) && (
                  <span className="basis-full text-amber-700">※ 未架電が枯渇したため過去架電企業を表示中</span>
                )}
              </div>
            )}

            {/* ピックアップモード切替 */}
            <div className="mb-3">
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {[
                  { value: 'auto', label: '自動' },
                  { value: 'industry', label: '業種別' },
                  { value: 'mylist', label: '自作' },
                  { value: 'special', label: '特別' },
                ].map(m => (
                  <button key={m.value}
                    onClick={() => { setPickupMode(m.value); }}
                    className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                      pickupMode === m.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>{m.label}</button>
                ))}
              </div>
              {pickupMode === 'industry' && (
                <>
                  <select
                    value={selectedIndustry}
                    onChange={e => setSelectedIndustry(e.target.value)}
                    className="input text-xs mt-1.5 w-full"
                  >
                    <option value="">業種を選択</option>
                    {['飲食', '製造', '小売', '建設', '宿泊', '農業', '介護'].map(ind => (
                      <option key={ind} value={ind}>{ind}</option>
                    ))}
                  </select>
                  {selectedIndustry && (
                    <select
                      value={selectedRegion}
                      onChange={e => setSelectedRegion(e.target.value)}
                      className="input text-xs mt-1.5 w-full"
                      title={availableRegions.length === 0
                        ? '業種地域ルール未設定のため全都道府県から選択可'
                        : '架電ルールで設定された都道府県を優先表示'}
                    >
                      <option value="">全都道府県 (絞り込みなし)</option>
                      {(availableRegions.length > 0 ? availableRegions : [
                        '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
                        '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
                        '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
                        '岐阜県', '静岡県', '愛知県', '三重県',
                        '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
                        '鳥取県', '島根県', '岡山県', '広島県', '山口県',
                        '徳島県', '香川県', '愛媛県', '高知県',
                        '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
                      ]).map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {pickupMode === 'special' && (
                <div className="mt-2">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2 mb-2">
                    <p className="text-[10px] text-red-600 font-bold">失注やバラシになった案件に再架電する場合のみ使用可</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-2 flex items-center justify-between">
                    <span className="text-[10px] text-blue-700">クイックビュー (上位20件)</span>
                    <Link
                      href="/special-list"
                      className="text-[10px] text-blue-700 hover:text-blue-900 font-bold underline"
                    >全体を見る</Link>
                  </div>
                  <button
                    onClick={() => setShowSpecialAdd(!showSpecialAdd)}
                    className="w-full text-[11px] text-blue-600 hover:bg-blue-50 py-1.5 rounded-md transition-colors font-medium"
                  >{showSpecialAdd ? '閉じる' : '+ 手動追加'}</button>
                  {showSpecialAdd && (
                    <div className="mt-2 space-y-1.5">
                      <input
                        type="text"
                        placeholder="企業名 *"
                        value={specialForm.company_name}
                        onChange={e => setSpecialForm(f => ({ ...f, company_name: e.target.value }))}
                        className="input text-xs w-full"
                      />
                      <input
                        type="text"
                        placeholder="電話番号 *"
                        value={specialForm.phone_number}
                        onChange={e => setSpecialForm(f => ({ ...f, phone_number: e.target.value }))}
                        className="input text-xs w-full"
                      />
                      {isManager && operatorList.length > 0 && (
                        <select
                          value={specialOperatorId}
                          onChange={e => setSpecialOperatorId(e.target.value)}
                          className="input text-xs w-full"
                        >
                          <option value="">優先オペレーターを選択</option>
                          {operatorList.map(op => (
                            <option key={op.id} value={op.id}>{op.name}</option>
                          ))}
                        </select>
                      )}
                      <button
                        onClick={async () => {
                          if (!specialForm.company_name.trim() || !specialForm.phone_number.trim()) {
                            toast.error('企業名と電話番号は必須です');
                            return;
                          }
                          setSpecialAdding(true);
                          try {
                            const payload = { ...specialForm };
                            if (isManager && specialOperatorId) {
                              payload.priority_operator_id = Number(specialOperatorId);
                            }
                            await api.post('/api/csv/manual-special', payload);
                            toast.success('特別リストに追加しました');
                            setSpecialForm({ company_name: '', phone_number: '' });
                            setSpecialOperatorId('');
                            setShowSpecialAdd(false);
                            fetchCallList();
                          } catch (err) {
                            toast.error(err.response?.data?.message || '追加に失敗しました');
                          } finally {
                            setSpecialAdding(false);
                          }
                        }}
                        disabled={specialAdding}
                        className="w-full btn-primary text-xs py-1.5 disabled:opacity-50"
                      >{specialAdding ? '追加中...' : '追加'}</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5 max-h-[calc(100vh-300px)] overflow-y-auto">
              {listLoading && targetList.length === 0 ? (
                <div className="py-8 text-center">
                  <svg className="animate-spin w-5 h-5 text-gray-400 mx-auto" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : targetList.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                    </svg>
                  </div>
                  <p className="text-xs text-gray-400">架電対象なし</p>
                </div>
              ) : (
                targetList.map((target) => (
                  <div
                    key={target.id}
                    onClick={() => !calling && !excludedIds.has(target.id) && handleSelectTarget(target)}
                    className={`relative group p-3 rounded-lg transition-all duration-150 border ${
                      selectedTargetId === target.id
                        ? 'bg-blue-50 border-blue-200 shadow-sm'
                        : 'bg-gray-50/50 border-transparent hover:bg-gray-100/80'
                   } ${calling || excludedIds.has(target.id) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{target.company_name}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{target.phone_number}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {/* 特別リスト優先度バッジ (A=赤、 B=黄、 C=青、 D=灰) */}
                        {target.priority && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            target.priority === 'A' ? 'bg-red-100 text-red-700' :
                            target.priority === 'B' ? 'bg-amber-100 text-amber-800' :
                            target.priority === 'C' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`} title={`優先度 ${target.priority}`}>{target.priority}</span>
                        )}
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${reasonColors[target.reason] || 'bg-gray-100 text-gray-600'}`}>
                          {reasonLabels[target.reason] || ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      {target.industry ? (
                        <p className="text-[11px] text-gray-400">
                          {target.industry}{target.region ? ` / ${target.region}` : ''}
                          {target.industry_category && target.industry_category !== 'その他' && (
                            <span className={`ml-1 text-[9px] px-1 py-0 rounded ${
                              target.industry_category === '建設' ? 'bg-orange-50 text-orange-700' :
                              target.industry_category === '小売' ? 'bg-purple-50 text-purple-700' :
                              target.industry_category === '製造' ? 'bg-blue-50 text-blue-700' :
                              target.industry_category === '飲食' ? 'bg-red-50 text-red-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>{target.industry_category}</span>
                          )}
                        </p>
                      ) : <span />}
                      {/* スキップボタン */}
                      {!calling && (
                        <button
                          onClick={(e) => handleSkip(target.id, e)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-gray-400 hover:text-red-500 hover:bg-red-50 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                          title="スキップ"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
                          </svg>
                          スキップ
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 右: メインエリア (3カラム) */}
        <div className="xl:col-span-3">
          {!company ? (
            <div className="card p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </div>
              <p className="text-gray-500 text-sm">左のリストから架電先を選択してください</p>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* 企業情報 */}
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-gray-800">企業情報</h2>
                  {reason && (
                    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${reasonColors[reason] || 'bg-gray-100 text-gray-600'}`}>
                      {reasonLabels[reason] || reason}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {[
                    { label: '企業名', value: company.company_name, bold: true },
                    { label: '電話番号', value: company.phone_number },
                    { label: '業種', value: company.industry },
                    { label: '職種', value: company.job_type },
                    { label: '住所', value: company.address },
                    { label: 'データ元', value: company.data_source },
                  ].map((item) => (
                    <div key={item.label} className="flex items-baseline justify-between text-sm">
                      <span className="text-gray-400 text-xs">{item.label}</span>
                      {item.bold ? (
                        <span
                          className="font-semibold text-blue-700 hover:text-blue-900 hover:underline cursor-pointer transition-colors"
                          title="クリックでハローワーク検索"
                          onClick={() => {
                            const query = encodeURIComponent(`${item.value} ハローワーク`);
                            window.open(`https://www.google.com/search?q=${query}`, '_blank');
                          }}
                        >
                          {item.value || '-'}
                        </span>
                      ) : (
                        <span className="text-gray-700">
                          {item.value || '-'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {company.comment && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-1">コメント</p>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{company.comment}</p>
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-xs font-semibold text-gray-500">アクション履歴 (自動)</h3>
                    <span className="text-[10px] text-gray-400">通話結果 / FAX送信 / 受電報告 を自動集約</span>
                  </div>

                  {companyActions.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-3">履歴なし</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {companyActions.slice(0, 30).map(a => {
                        const isCall = a.source === 'call';
                        const isFax  = a.source === 'fax-crm';
                        const bgCls = isCall ? 'bg-blue-50/60 border-blue-100'
                                   : isFax  ? 'bg-emerald-50/60 border-emerald-100'
                                   :          'bg-purple-50/60 border-purple-100';
                        const badgeCls = isCall ? 'bg-blue-100 text-blue-800'
                                       : isFax  ? 'bg-emerald-100 text-emerald-800'
                                       :          'bg-purple-100 text-purple-800';
                        const dateStr = a.created_at
                          ? new Date(a.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : (a.action_date ? new Date(a.action_date).toLocaleDateString('ja-JP') : '-');
                        return (
                          <div key={`${a.source}-${a.id}`} className={`rounded-lg p-2 text-xs border ${bgCls}`}>
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeCls}`}>
                                  {a.action_type}
                                </span>
                                {isFax && <span className="text-[9px] text-emerald-700">fax-crm</span>}
                                <span className="text-gray-400 text-[10px]">{dateStr}</span>
                              </div>
                              <span className="font-semibold text-gray-700 text-[11px]">{a.result || '-'}</span>
                            </div>
                            <div className="flex justify-between items-start mt-1">
                              <div className="text-gray-500 text-[10px] flex-1">
                                <span className="font-medium">{a.user_name || '-'}</span>
                                {a.result === 'NG' && a.ng_reason && (
                                  <span className="ml-1 text-red-600">／ {a.ng_reason}</span>
                                )}
                                {(a.contact_person_name || a.contact_person_phone) && (
                                  <span className="ml-1 text-indigo-700">／ 担当: {a.contact_person_name || '?'}{a.contact_person_phone ? ` (${a.contact_person_phone})` : ''}</span>
                                )}
                                {a.memo && <p className="mt-0.5 leading-relaxed">{a.memo}</p>}
                              </div>
                              {!isCall && !isFax && (
                                <button onClick={() => deleteCompanyAction(a.id)}
                                  className="text-[10px] text-red-500 hover:underline ml-2">削除</button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 架電操作 */}
              <div className="card p-5 flex flex-col items-center justify-center min-h-[400px]">
                <p className="text-xl font-bold text-gray-900 tracking-wider mb-1">{company.phone_number}</p>
                <p className="text-[10px] text-gray-400 -mt-0.5">Zoom発信先: {formatPhoneForZoom(company.phone_number)}</p>
                <p className="text-sm text-gray-400 mb-8 mt-1">{company.company_name}</p>

                {!calling ? (
                  <button
                    onClick={handleStartCall}
                    disabled={selecting}
                    className={`group w-36 h-36 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white text-lg font-bold shadow-lg shadow-emerald-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-emerald-500/30 hover:scale-[1.03] active:scale-95 flex items-center justify-center ${selecting ? 'opacity-60 cursor-not-allowed hover:scale-100' : ''}`}
                  >
                    <div className="text-center">
                      {selecting ? (
                        <>
                          <svg className="w-8 h-8 mx-auto mb-1.5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span className="text-sm font-bold">選択中...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-8 h-8 mx-auto mb-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                          </svg>
                          <span className="text-sm font-bold">自動架電開始</span>
                        </>
                      )}
                    </div>
                  </button>
                ) : (
                  <div className="relative">
                    <div className="absolute inset-0 w-36 h-36 rounded-full bg-red-400/30 pulse-ring" />
                    <button
                      onClick={() => {
                        // 通話中状態を解除 + 一時停止（callIdは保持 → 結果入力可能）
                        setCalling(false);
                        setAutoPaused(true);
                        autoPausedRef.current = true;
                      }}
                      className="relative w-36 h-36 rounded-full bg-gradient-to-br from-red-400 to-red-600 text-white text-lg font-bold shadow-lg shadow-red-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-red-500/30 active:scale-95 flex items-center justify-center"
                    >
                      <div className="text-center">
                        <svg className="w-8 h-8 mx-auto mb-1.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3.68 16.07l3.92-3.11c.28-.22.47-.56.47-.95v-3.56c2.67-.89 5.56-.89 8.23 0V12c0 .38.18.73.47.95l3.92 3.11c.56.45 1.4.06 1.4-.65V5.33c0-.36-.18-.7-.5-.87A18.03 18.03 0 0012 2.42c-3.27 0-6.38.85-9.09 2.43a.97.97 0 00-.5.87v9.72c0 .71.84 1.1 1.4.65l-.13.02z" />
                        </svg>
                        <span className="text-sm font-bold">通話終了</span>
                      </div>
                    </button>
                  </div>
                )}

                {calling && (
                  <div className="mt-5 flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-sm text-emerald-600 font-medium">通話中</span>
                  </div>
                )}
                {autoMode && (
                  <div className="mt-2 flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2">
                      {autoPaused ? (
                        <span className="text-[11px] text-amber-600 font-medium bg-amber-50 px-2.5 py-1 rounded-full">一時停止中</span>
                      ) : (
                        <span className="text-[11px] text-blue-600 font-medium bg-blue-50 px-2.5 py-1 rounded-full">自動架電モード</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {autoPaused ? (
                        <button
                          onClick={() => {
                            setAutoPaused(false);
                            autoPausedRef.current = false;
                            // 企業が選択済みなら即座に架電開始
                            if (company && !calling) {
                              handleStartCall();
                            }
                          }}
                          className="text-[11px] text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 rounded-full transition-colors font-medium"
                        >▶ 再開</button>
                      ) : (
                        !calling && (
                          <button
                            onClick={() => {
                              setAutoPaused(true);
                              autoPausedRef.current = true;
                              toast('一時停止しました');
                            }}
                            className="text-[11px] text-amber-600 hover:bg-amber-50 px-2.5 py-1.5 rounded-full transition-colors font-medium border border-amber-200"
                          >一時停止</button>
                        )
                      )}
                      <button
                        onClick={() => {
                          setAutoMode(false);
                          setAutoPaused(false);
                          autoPausedRef.current = false;
                        }}
                        className="text-[11px] text-gray-400 hover:text-red-500 hover:bg-red-50 px-2 py-1.5 rounded-full transition-colors"
                        title="自動架電を完全停止"
                      >✕ 停止</button>
                    </div>
                  </div>
                )}
              </div>

              {/* 結果入力 */}
              <div className={`card p-5 ${(calling && !autoMode) ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-gray-800">結果入力</h2>
                  {(calling && !autoMode) && (
                    <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">自動架電停止後に入力</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mb-5">
                  {RESULT_CODES.map((rc) => (
                    <button
                      key={rc.code}
                      onClick={() => setResultCode(prev => prev === rc.code ? '' : rc.code)}
                      disabled={calling && !autoMode}
                      className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-all duration-150 ${
                        resultCode === rc.code
                          ? `${rc.activeBg} ${rc.activeText} shadow-sm scale-[1.02]`
                          : `${rc.bg} ${rc.text} hover:opacity-80`
                      }`}
                    >
                      {rc.label}
                    </button>
                  ))}
                </div>

                {/* チェックボックス */}
                <div className="space-y-2.5 mb-5">
                  {[
                    { label: '有効接続', checked: isEffective, onChange: setIsEffective },
                    { label: '担当者接続', checked: isPerson, onChange: setIsPerson },
                  ].map((item) => (
                    <label key={item.label} className="flex items-center gap-2.5 text-sm cursor-pointer group">
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                        item.checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover:border-blue-400'
                      }`}>
                        {item.checked && (
                          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <input type="checkbox" checked={item.checked} onChange={(e) => item.onChange(e.target.checked)} className="sr-only" />
                      <span className="text-gray-700">{item.label}</span>
                    </label>
                  ))}
                </div>

                {resultCode === 'PROJECT' && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <label className="flex items-center gap-2.5 text-sm cursor-pointer group">
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                        isProspect ? 'bg-amber-500 border-amber-500' : 'border-gray-300 group-hover:border-amber-400'
                      }`}>
                        {isProspect && (
                          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <input type="checkbox" checked={isProspect} onChange={(e) => setIsProspect(e.target.checked)} className="sr-only" />
                      <span className="text-amber-700 font-medium">見込案件</span>
                    </label>
                    {isProspect && (
                      <p className="text-[10px] text-amber-500 mt-1.5 ml-7">案件カウントに含まれません。案件管理から正式案件に変更できます。</p>
                    )}
                  </div>
                )}

                {resultCode === 'RECALL' && (
                  <div className="mb-4">
                    <label className="input-label">リコール日時 *</label>
                    <input
                      type="datetime-local"
                      value={recallAt}
                      onChange={(e) => setRecallAt(e.target.value)}
                      className="input"
                    />
                  </div>
                )}

                {resultCode === 'NG' && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <label className="input-label text-red-700">NG理由 *</label>
                    <select
                      value={ngReason}
                      onChange={(e) => setNgReason(e.target.value)}
                      className="input"
                    >
                      <option value="">選択してください</option>
                      <option value="今は募集していない">今は募集していない</option>
                      <option value="外国人NG">外国人NG</option>
                      <option value="技人国NG">技人国NG</option>
                      <option value="特定技能のみ募集中">特定技能のみ募集中</option>
                      <option value="アルバイトだけ(正社員NG)">アルバイトだけ(正社員NG)</option>
                      <option value="経験者のみ(専門分野を学習含む)">経験者のみ(専門分野を学習含む)</option>
                      <option value="今忙しい(対応不可)">今忙しい(対応不可)</option>
                      <option value="ハローワークからしか募集していない">ハローワークからしか募集していない</option>
                      <option value="決まったところ(ハローワーク以外)からしか募集していない">決まったところ(ハローワーク以外)からしか募集していない</option>
                      <option value="信用できない(怪しいから)">信用できない(怪しいから)</option>
                      <option value="対面面接のみ(遠方で直接は行けない)">対面面接のみ(遠方で直接は行けない)</option>
                    </select>
                  </div>
                )}

                {/* 担当者情報（リコール時 or 担当者接続にチェック時） */}
                {(resultCode === 'RECALL' || isPerson) && (
                  <div className="mb-5 p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-indigo-700">担当者情報</h3>
                      <span className="text-[10px] text-indigo-500">すべて任意・聞けた範囲で入力</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="input-label">担当者名</label>
                        <input
                          type="text"
                          value={contactPersonName}
                          onChange={(e) => setContactPersonName(e.target.value)}
                          className="input"
                          placeholder="例: 山田太郎"
                        />
                      </div>
                      <div>
                        <label className="input-label">性別</label>
                        <select
                          value={contactPersonGender}
                          onChange={(e) => setContactPersonGender(e.target.value)}
                          className="input"
                        >
                          <option value="">選択...</option>
                          <option value="男性">男性</option>
                          <option value="女性">女性</option>
                          <option value="不明">不明</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="input-label">担当者の電話番号</label>
                      <input
                        type="tel"
                        value={contactPersonPhone}
                        onChange={(e) => setContactPersonPhone(e.target.value)}
                        className="input"
                        placeholder="例: 090-1234-5678"
                      />
                    </div>
                    <div>
                      <label className="input-label">印象 / メモ</label>
                      <textarea
                        value={contactPersonImpression}
                        onChange={(e) => setContactPersonImpression(e.target.value)}
                        rows={2}
                        className="input resize-none"
                        placeholder="話し方、雰囲気、関心の度合いなど"
                      />
                    </div>
                  </div>
                )}

                <div className="mb-5">
                  <label className="input-label">メモ</label>
                  <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    rows={4}
                    className="input resize-none"
                    placeholder="通話メモを入力..."
                  />
                </div>

                <button
                  onClick={handleEndCall}
                  disabled={!callId || !resultCode || (calling && !autoMode)}
                  className={`w-full disabled:opacity-40 disabled:cursor-not-allowed ${
                    resultCode && callId ? 'btn-primary animate-pulse' : 'btn-primary'
                  }`}
                >
                  {autoMode && !autoPaused ? '保存して次へ架電 ▶' : '保存して次へ'}
                </button>
                {resultCode && callId && (
                  <p className="text-xs text-red-500 text-center mt-1 font-medium">結果を保存してください</p>
                )}
              </div>
            </div>

            {/* スクリプトパネル（アウト返し・Q&A） */}
            <div className="card p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-800">アウト返し・Q&A</h2>
                <div className="flex items-center gap-2">
                  {company?.industry && (
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scriptShowAll}
                        onChange={(e) => setScriptShowAll(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-gray-300"
                      />
                      全業種表示
                    </label>
                  )}
                  <input
                    type="text"
                    value={scriptSearch}
                    onChange={(e) => setScriptSearch(e.target.value)}
                    placeholder="検索..."
                    className="input text-xs py-1 px-2.5 w-36"
                  />
                </div>
              </div>

              {/* タブ切替 */}
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5 mb-3 w-fit">
                {[
                  { value: 'rebuttal', label: 'アウト返し' },
                  { value: 'qa', label: 'Q&A' },
                ].map(t => (
                  <button
                    key={t.value}
                    onClick={() => setScriptTab(t.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      scriptTab === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >{t.label}</button>
                ))}
              </div>

              {/* スクリプト一覧 */}
              <div className="max-h-[280px] overflow-y-auto space-y-2">
                {filteredScripts.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">該当するスクリプトがありません</p>
                ) : (
                  filteredScripts.map(item => (
                    <div key={item.id} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <span className="text-xs font-bold text-blue-600 mt-0.5 flex-shrink-0">Q.</span>
                        <p className="text-sm font-semibold text-gray-800">{item.trigger_text}</p>
                      </div>
                      <div className="flex items-start gap-2 mt-1.5">
                        <span className="text-xs font-bold text-emerald-600 mt-0.5 flex-shrink-0">A.</span>
                        <p className="text-sm text-gray-600 leading-relaxed">{item.response_text}</p>
                      </div>
                      {item.category && (
                        <span className="inline-block mt-2 text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{item.category}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            </>
          )}
        </div>
      </div>

      {showProjectModal && savedProjectId && (
        <ProjectModal
          projectId={savedProjectId}
          onClose={() => { setShowProjectModal(false); setSavedProjectId(null); }}
        />
      )}
    </Layout>
  );
}
