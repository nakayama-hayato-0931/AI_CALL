/**
 * 架電画面
 * 架電リスト + 企業情報 + 架電操作 + 結果入力
 * 排他制御: 選択時にロック取得、終話/スキップ時にロック解除
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import Layout from '../components/common/Layout';
import ProjectModal from '../components/ProjectModal';
import api from '../utils/api';
import toast from 'react-hot-toast';

const GMAIL_URL = 'https://mail.google.com/mail/u/0/?authuser=hitokiwa.recruit@gmail.com';
const DASHBOARD_URL = 'https://hitokiwa-dashboard.vercel.app/';

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

  // 架電リスト
  const [targetList, setTargetList] = useState([]);
  const [listLoading, setListLoading] = useState(true);

  // 選択中の企業
  const [company, setCompany] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState(null);
  const [callHistory, setCallHistory] = useState([]);
  const [reason, setReason] = useState('');

  // 通話状態
  const [callId, setCallId] = useState(null);
  const [calling, setCalling] = useState(false);
  const [autoMode, setAutoMode] = useState(false);

  // 結果入力
  const [resultCode, setResultCode] = useState('');
  const [memo, setMemo] = useState('');
  const [recallAt, setRecallAt] = useState('');
  const [isEffective, setIsEffective] = useState(false);
  const [isPerson, setIsPerson] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState(null);

  // ピックアップモード
  const [pickupMode, setPickupMode] = useState('auto'); // 'auto' | 'industry' | 'mylist' | 'special'
  const [selectedIndustry, setSelectedIndustry] = useState('');

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
  pickupModeRef.current = pickupMode;
  selectedIndustryRef.current = selectedIndustry;

  // モードパラメータ構築ヘルパー
  const getModeParams = useCallback(() => {
    const params = {};
    if (pickupMode !== 'auto') params.mode = pickupMode;
    if (pickupMode === 'industry' && selectedIndustry) params.industry = selectedIndustry;
    return params;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupMode, selectedIndustry]);

  // 架電リスト取得
  const fetchCallList = useCallback(async () => {
    setListLoading(true);
    try {
      const { data } = await api.get('/api/companies/call-list', { params: getModeParams() });
      setTargetList(data.data.targets || []);
    } catch (err) {
      toast.error('架電リストの取得に失敗しました');
    } finally {
      setListLoading(false);
    }
  }, [getModeParams]);

  // 初回読み込み + モード変更時（fetchCallList は getModeParams に依存し、getModeParams は pickupMode/selectedIndustry に依存）
  useEffect(() => {
    fetchCallList();
  }, [fetchCallList]);

  // ピックアップ: 架電リストページからのロック済み企業を自動読み込み
  useEffect(() => {
    if (!router.isReady) return;
    const pickupId = router.query.pickup;
    if (!pickupId) return;

    const loadPickedCompany = async () => {
      try {
        // 既にロック済みなので企業情報を取得するだけ
        const { data } = await api.get(`/api/companies/${pickupId}`);
        setCompany(data.data.company);
        setCallHistory(data.data.callHistory || []);
        setSelectedTargetId(parseInt(pickupId, 10));
        setReason('pickup');
        resetForm();
        toast.success(`${data.data.company.company_name} をピックアップ済み`);
      } catch (err) {
        toast.error('ピックアップした企業の読み込みに失敗しました');
      }
      // URLからpickupパラメータを削除（再読み込み防止）
      router.replace('/call', undefined, { shallow: true });
    };

    loadPickedCompany();
  }, [router.isReady, router.query.pickup]);

  // ページ離脱時にロック解除（ベストエフォート）
  useEffect(() => {
    const handleBeforeUnload = () => {
      // 未保存のcallをキャンセル
      const cId = callIdRef.current;
      if (cId) {
        navigator.sendBeacon(
          `/api/calls/${cId}/cancel-beacon`,
          new Blob([JSON.stringify({})], { type: 'application/json' })
        );
      }
      // ロック解除
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
    if (calling) return;
    try {
      // 前回の未保存callがあればキャンセル
      await cancelUnsavedCall();
      // 前のロックを解除
      if (selectedTargetId && selectedTargetId !== target.id) {
        await api.post(`/api/companies/${selectedTargetId}/unlock`).catch(() => {});
      }
      // 新しいロックを取得
      const { data } = await api.post(`/api/companies/${target.id}/lock`);
      setCompany(data.data.company);
      setCallHistory(data.data.callHistory || []);
      setSelectedTargetId(target.id);
      setReason(target.reason);
      // フォームリセット
      setResultCode('');
      setMemo('');
      setRecallAt('');
      setIsEffective(false);
      setIsPerson(false);
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('この企業は他のオペレーターが対応中です');
        fetchCallList();
      } else {
        toast.error('選択に失敗しました');
      }
    }
  };

  // フォームリセット（共通）
  const resetForm = () => {
    setResultCode('');
    setMemo('');
    setRecallAt('');
    setIsEffective(false);
    setIsPerson(false);
  };

  // 自動で次の架電先へ進む（ロック取得まで。架電開始は手動）
  const autoAdvanceToNext = async (excludeId = null) => {
    try {
      // 最新リストを取得（refから最新モード値を取得）
      const params = {};
      if (pickupModeRef.current !== 'auto') params.mode = pickupModeRef.current;
      if (pickupModeRef.current === 'industry' && selectedIndustryRef.current) params.industry = selectedIndustryRef.current;
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
        toast('架電対象がなくなりました', { icon: '📋' });
        return;
      }

      // リスト先頭のターゲットを自動選択
      const nextTarget = targets[0];

      // ロック取得
      const lockRes = await api.post(`/api/companies/${nextTarget.id}/lock`);
      const nextCompany = lockRes.data.data.company;
      setCompany(nextCompany);
      setCallHistory(lockRes.data.data.callHistory || []);
      setSelectedTargetId(nextTarget.id);
      setReason(nextTarget.reason);
      resetForm();

      // ここで止まる（架電開始ボタンを手動で押す）
      toast.success(`次の架電先: ${nextCompany.company_name}`);
    } catch (err) {
      if (err.response?.status === 409) {
        // ロック競合 → リスト再取得して手動選択に戻す
        toast.error('次の架電先は他のオペレーターが対応中です。リストから選択してください。');
        setCompany(null);
        setSelectedTargetId(null);
        await fetchCallList();
      } else {
        toast.error('自動選択に失敗しました');
        setCompany(null);
        setSelectedTargetId(null);
        await fetchCallList();
      }
    }
  };

  // 自動架電モード: 次の架電先に進み、自動で架電開始
  const autoAdvanceAndCall = async (excludeId = null) => {
    try {
      // 最新リストを取得（refから最新モード値を取得）
      const params = {};
      if (pickupModeRef.current !== 'auto') params.mode = pickupModeRef.current;
      if (pickupModeRef.current === 'industry' && selectedIndustryRef.current) params.industry = selectedIndustryRef.current;
      if (excludeId) params.exclude = excludeId;
      const { data } = await api.get('/api/companies/call-list', { params });
      const targets = data.data.targets || [];
      setTargetList(targets);

      if (targets.length === 0) {
        // 架電対象なし → 自動架電モード終了
        setAutoMode(false);
        setCalling(false);
        setCompany(null);
        setSelectedTargetId(null);
        setCallHistory([]);
        setReason('');
        toast('架電対象がなくなりました。自動架電を終了します。', { icon: '📋' });
        return;
      }

      // リスト先頭のターゲットを自動選択
      const nextTarget = targets[0];

      // ロック取得
      const lockRes = await api.post(`/api/companies/${nextTarget.id}/lock`);
      const nextCompany = lockRes.data.data.company;
      setCompany(nextCompany);
      setCallHistory(lockRes.data.data.callHistory || []);
      setSelectedTargetId(nextTarget.id);
      setReason(nextTarget.reason);
      resetForm();

      // 自動で架電開始
      const callRes = await api.post('/api/calls/start', { company_id: nextCompany.id });
      setCallId(callRes.data.data.callId);
      setCalling(true);
      const phoneForZoom = nextCompany.phone_number.startsWith('0')
        ? '+81' + nextCompany.phone_number.slice(1)
        : nextCompany.phone_number;
      window.location.href = `zoomphonecall://${phoneForZoom}`;
      toast.success(`自動架電: ${nextCompany.company_name}`);
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('次の架電先は他のオペレーターが対応中です。リストから選択してください。');
        setAutoMode(false);
        setCalling(false);
        setCompany(null);
        setSelectedTargetId(null);
        await fetchCallList();
      } else {
        toast.error('自動架電に失敗しました');
        setAutoMode(false);
        setCalling(false);
        setCompany(null);
        setSelectedTargetId(null);
        await fetchCallList();
      }
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
    try {
      // 前回の未保存callがあればキャンセル
      await cancelUnsavedCall();
      const { data } = await api.post('/api/calls/start', { company_id: company.id });
      setCallId(data.data.callId);
      setCalling(true);
      setAutoMode(true);
      // ZoomPhone起動: zoomphonecall://電話番号 でZoom Phoneアプリを起動
      const phoneForZoom = company.phone_number.startsWith('0')
        ? '+81' + company.phone_number.slice(1)
        : company.phone_number;
      window.location.href = `zoomphonecall://${phoneForZoom}`;
      toast.success('自動架電モードを開始しました');
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error('ロックが失われました。もう一度選択してください。');
        fetchCallList();
      } else {
        toast.error('架電開始に失敗しました');
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
    try {
      const response = await api.put(`/api/calls/${callId}/end`, {
        result_code: resultCode,
        memo,
        recall_at: recallAt || null,
        is_effective_connection: isEffective,
        is_person_in_charge: isPerson,
      });
      toast.success('通話結果を保存しました');
      const prevId = selectedTargetId;
      const wasAutoMode = autoMode;

      // フォームを即座にリセット（次の架電先に引き継がないようにする）
      resetForm();

      // 興味あり: Gmail開く + 自動架電停止
      if (resultCode === 'INTERESTED') {
        setAutoMode(false);
        setCalling(false);
        setCallId(null);
        window.open(GMAIL_URL, '_blank');
        await autoAdvanceToNext(prevId);
        return;
      }

      // 案件化: ダッシュボード+Gmail開く + モーダル表示 + 自動架電停止
      if (resultCode === 'PROJECT') {
        setAutoMode(false);
        setCalling(false);
        setCallId(null);
        window.open(DASHBOARD_URL, '_blank');
        window.open(GMAIL_URL, '_blank');
        setSavedProjectId(response.data.data.projectId);
        setShowProjectModal(true);
        await autoAdvanceToNext(prevId);
        return;
      }

      // 通話状態リセット
      setCalling(false);
      setCallId(null);

      if (wasAutoMode) {
        // 自動架電モード: 次へ進み自動で架電開始
        await autoAdvanceAndCall(prevId);
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
      // リストから即座に除外
      setTargetList(prev => prev.filter(t => t.id !== targetId));
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
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-800">架電リスト</h2>
              <button
                onClick={fetchCallList}
                disabled={listLoading}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
              >
                <svg className={`w-3.5 h-3.5 ${listLoading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                </svg>
                更新
              </button>
            </div>

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
                    onClick={() => !calling && handleSelectTarget(target)}
                    className={`relative group p-3 rounded-lg transition-all duration-150 border ${
                      selectedTargetId === target.id
                        ? 'bg-blue-50 border-blue-200 shadow-sm'
                        : 'bg-gray-50/50 border-transparent hover:bg-gray-100/80'
                    } ${calling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{target.company_name}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{target.phone_number}</p>
                      </div>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${reasonColors[target.reason] || 'bg-gray-100 text-gray-600'}`}>
                        {reasonLabels[target.reason] || ''}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      {target.industry ? (
                        <p className="text-[11px] text-gray-400">{target.industry}{target.region ? ` / ${target.region}` : ''}</p>
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

                {callHistory.length > 0 && (
                  <div className="mt-5 pt-4 border-t border-gray-100">
                    <h3 className="text-xs font-semibold text-gray-500 mb-2.5">前回履歴</h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {callHistory.slice(0, 5).map((c) => (
                        <div key={c.id} className="bg-gray-50 rounded-lg p-2.5 text-xs">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">
                              {new Date(c.call_started_at).toLocaleString('ja-JP')}
                            </span>
                            <span className="font-semibold text-gray-700">{c.result_code || '-'}</span>
                          </div>
                          {c.memo && <p className="text-gray-500 mt-1 leading-relaxed">{c.memo}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 架電操作 */}
              <div className="card p-5 flex flex-col items-center justify-center min-h-[400px]">
                <p className="text-xl font-bold text-gray-900 tracking-wider mb-1">{company.phone_number}</p>
                <p className="text-sm text-gray-400 mb-8">{company.company_name}</p>

                {!calling ? (
                  <button
                    onClick={handleStartCall}
                    className="group w-36 h-36 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white text-lg font-bold shadow-lg shadow-emerald-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-emerald-500/30 hover:scale-[1.03] active:scale-95 flex items-center justify-center"
                  >
                    <div className="text-center">
                      <svg className="w-8 h-8 mx-auto mb-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                      </svg>
                      <span className="text-sm font-bold">自動架電開始</span>
                    </div>
                  </button>
                ) : (
                  <div className="relative">
                    <div className="absolute inset-0 w-36 h-36 rounded-full bg-red-400/30 pulse-ring" />
                    <button
                      onClick={() => {
                        // 通話中状態を解除（callIdは保持 → 結果入力可能）
                        setCalling(false);
                      }}
                      className="relative w-36 h-36 rounded-full bg-gradient-to-br from-red-400 to-red-600 text-white text-lg font-bold shadow-lg shadow-red-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-red-500/30 active:scale-95 flex items-center justify-center"
                    >
                      <div className="text-center">
                        <svg className="w-8 h-8 mx-auto mb-1.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3.68 16.07l3.92-3.11c.28-.22.47-.56.47-.95v-3.56c2.67-.89 5.56-.89 8.23 0V12c0 .38.18.73.47.95l3.92 3.11c.56.45 1.4.06 1.4-.65V5.33c0-.36-.18-.7-.5-.87A18.03 18.03 0 0012 2.42c-3.27 0-6.38.85-9.09 2.43a.97.97 0 00-.5.87v9.72c0 .71.84 1.1 1.4.65l-.13.02z" />
                        </svg>
                        <span className="text-sm font-bold">自動架電停止</span>
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
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-blue-600 font-medium bg-blue-50 px-2.5 py-1 rounded-full">🔄 自動架電モード</span>
                    <button
                      onClick={() => setAutoMode(false)}
                      className="text-[11px] text-gray-400 hover:text-red-500 hover:bg-red-50 px-2 py-1 rounded-full transition-colors"
                      title="自動架電を停止"
                    >✕ 停止</button>
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
                  {autoMode ? '保存して次へ架電 ▶' : '保存して次へ'}
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
